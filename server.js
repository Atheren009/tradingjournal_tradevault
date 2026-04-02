require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const pool = require('./db/connection');
const RLEngine = require('./rl/engine');
const QUANT_STRATEGIES = require('./rl/quant-strategies');
const LiveSignalEngine = require('./rl/live-signals');
const http = require('http');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'tradevault_secret_key_change_in_production';
const OTP_TTL_MINUTES = 10;
const PASSWORD_RESET_TTL_MINUTES = 15;
const MAIL_FROM = process.env.SMTP_FROM || 'TradeVault <no-reply@tradevault.local>';
const SMTP_SERVICE = process.env.SMTP_SERVICE || '';

const mailTransport = (SMTP_SERVICE || process.env.SMTP_HOST)
    ? nodemailer.createTransport(
        SMTP_SERVICE
            ? {
                service: SMTP_SERVICE,
                auth: process.env.SMTP_USER
                    ? {
                        user: process.env.SMTP_USER,
                        pass: process.env.SMTP_PASS || '',
                    }
                    : undefined,
            }
            : {
                host: process.env.SMTP_HOST,
                port: Number(process.env.SMTP_PORT || 587),
                secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
                auth: process.env.SMTP_USER
                    ? {
                        user: process.env.SMTP_USER,
                        pass: process.env.SMTP_PASS || '',
                    }
                    : undefined,
            }
    )
    : null;

function issueAccessToken(user) {
    return jwt.sign({ userId: user.user_id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

function issuePendingToken(userId, purpose) {
    return jwt.sign({ userId, purpose }, JWT_SECRET, { expiresIn: '10m' });
}

function hashCode(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function generateOtpCode() {
    return String(crypto.randomInt(100000, 1000000));
}

function withMinutesFromNow(minutes) {
    return new Date(Date.now() + minutes * 60 * 1000);
}

function maskEmail(email) {
    if (!email || !email.includes('@')) return 'your recovery email';
    const [name, domain] = email.split('@');
    if (!name) return `***@${domain}`;
    const safeName = name.length <= 2
        ? `${name[0]}*`
        : `${name.slice(0, 2)}${'*'.repeat(Math.max(2, name.length - 2))}`;
    return `${safeName}@${domain}`;
}

async function sendSecurityMail({ to, subject, title, message, code }) {
    const text = `${title}\n\n${message}\n\nCode: ${code}\n\nThis code expires soon. If you did not request it, you can ignore this email.`;
    const html = `
        <div style="font-family:Inter,Arial,sans-serif;background:#0b0f1a;padding:24px;color:#e2e8f0">
            <div style="max-width:520px;margin:0 auto;background:#111827;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:24px">
                <h2 style="margin:0 0 12px;font-size:22px;color:#f8fafc">${title}</h2>
                <p style="margin:0 0 18px;line-height:1.6;color:#94a3b8">${message}</p>
                <div style="display:inline-block;padding:14px 18px;border-radius:12px;background:#0f172a;border:1px solid rgba(99,102,241,0.35);font-size:28px;font-weight:800;letter-spacing:0.22em;color:#f8fafc">${code}</div>
                <p style="margin:18px 0 0;line-height:1.6;color:#64748b">This code expires soon. If you did not request it, you can ignore this email.</p>
            </div>
        </div>
    `;

    if (mailTransport) {
        try {
            await mailTransport.sendMail({ from: MAIL_FROM, to, subject, text, html });
            return 'email';
        } catch (err) {
            console.log('  ⚠ Email delivery failed, falling back to console:', err.message);
        }
    }

    console.log(`\n[TradeVault Security Mail]\nTo: ${to}\nSubject: ${subject}\nCode: ${code}\n`);
    return 'console';
}

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve login page at /login
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Serve login.html assets (CSS/JS embedded, but allow direct access)
app.use(express.static(path.join(__dirname, 'public')));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Multer config for screenshot uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `screenshot_${Date.now()}${ext}`);
    },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ========== AUTH ROUTES ==========

// DB migration: ensure auth and recovery columns exist
(async () => {
    try {
        const requiredColumns = [
            ['password_hash', 'VARCHAR(255) NOT NULL DEFAULT \'\' AFTER email'],
            ['recovery_email', 'VARCHAR(255) NULL AFTER password_hash'],
            ['two_factor_enabled', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER recovery_email'],
            ['login_otp_hash', 'VARCHAR(255) NULL AFTER two_factor_enabled'],
            ['login_otp_expires_at', 'DATETIME NULL AFTER login_otp_hash'],
            ['reset_otp_hash', 'VARCHAR(255) NULL AFTER login_otp_expires_at'],
            ['reset_otp_expires_at', 'DATETIME NULL AFTER reset_otp_hash'],
        ];

        for (const [columnName, definition] of requiredColumns) {
            const [cols] = await pool.query(
                `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
                 WHERE TABLE_SCHEMA = 'tradevault' AND TABLE_NAME = 'users' AND COLUMN_NAME = ?`,
                [columnName]
            );

            if (cols.length === 0) {
                await pool.query(`ALTER TABLE users ADD COLUMN ${columnName} ${definition}`);
                console.log(`  ✅ Added ${columnName} column to users table`);
            }
        }
    } catch (e) {
        console.log('  ⚠ Migration check skipped:', e.message);
    }
})();

app.post('/api/auth/signup', async (req, res) => {
    try {
        const { name, email, password, recovery_email } = req.body;
        const normalizedEmail = String(email || '').trim().toLowerCase();
        const normalizedRecoveryEmail = recovery_email && recovery_email.trim()
            ? recovery_email.trim().toLowerCase()
            : null;
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email, and password are required' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        // Check if email already exists
        const [existing] = await pool.query('SELECT user_id FROM users WHERE email = ?', [normalizedEmail]);
        if (existing.length > 0) {
            return res.status(409).json({ error: 'An account with this email already exists' });
        }

        // Hash password and create user
        const password_hash = await bcrypt.hash(password, 12);
        const [result] = await pool.query(
            'INSERT INTO users (name, email, password_hash, recovery_email) VALUES (?, ?, ?, ?)',
            [name, normalizedEmail, password_hash, normalizedRecoveryEmail]
        );

        const token = issueAccessToken({ user_id: result.insertId, email: normalizedEmail });

        res.status(201).json({
            token,
            user: { user_id: result.insertId, name, email: normalizedEmail, two_factor_enabled: false },
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = String(email || '').trim().toLowerCase();
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
        if (users.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const user = users[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        if (user.two_factor_enabled) {
            const code = generateOtpCode();
            const expiresAt = withMinutesFromNow(OTP_TTL_MINUTES);
            const destination = user.recovery_email || user.email;
            const deliveryMode = await sendSecurityMail({
                to: destination,
                subject: 'TradeVault sign-in verification code',
                title: 'Approve your TradeVault sign-in',
                message: `Use this one-time code to finish signing in to TradeVault. It was sent to your recovery destination: ${maskEmail(destination)}.`,
                code,
            });

            await pool.query(
                'UPDATE users SET login_otp_hash = ?, login_otp_expires_at = ? WHERE user_id = ?',
                [hashCode(code), expiresAt, user.user_id]
            );

            return res.json({
                requiresTwoFactor: true,
                pendingToken: issuePendingToken(user.user_id, 'login-2fa'),
                deliveryHint: maskEmail(destination),
                deliveryMode,
            });
        }

        const token = issueAccessToken(user);

        res.json({
            token,
            user: {
                user_id: user.user_id,
                name: user.name,
                email: user.email,
                two_factor_enabled: Boolean(user.two_factor_enabled),
            },
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/verify-2fa', async (req, res) => {
    try {
        const { pendingToken, code } = req.body;
        if (!pendingToken || !code) {
            return res.status(400).json({ error: 'Verification code is required' });
        }

        const decoded = jwt.verify(pendingToken, JWT_SECRET);
        if (decoded.purpose !== 'login-2fa') {
            return res.status(400).json({ error: 'Invalid verification session' });
        }

        const [users] = await pool.query(
            'SELECT user_id, name, email, two_factor_enabled, login_otp_hash, login_otp_expires_at FROM users WHERE user_id = ?',
            [decoded.userId]
        );
        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = users[0];
        const isExpired = !user.login_otp_expires_at || new Date(user.login_otp_expires_at).getTime() < Date.now();
        if (!user.login_otp_hash || isExpired) {
            return res.status(400).json({ error: 'This verification code has expired. Please sign in again.' });
        }

        if (hashCode(code.trim()) !== user.login_otp_hash) {
            return res.status(401).json({ error: 'Invalid verification code' });
        }

        await pool.query(
            'UPDATE users SET login_otp_hash = NULL, login_otp_expires_at = NULL WHERE user_id = ?',
            [user.user_id]
        );

        res.json({
            token: issueAccessToken(user),
            user: {
                user_id: user.user_id,
                name: user.name,
                email: user.email,
                two_factor_enabled: Boolean(user.two_factor_enabled),
            },
        });
    } catch (err) {
        if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Verification session expired. Please sign in again.' });
        }
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/resend-2fa', async (req, res) => {
    try {
        const { pendingToken } = req.body;
        if (!pendingToken) {
            return res.status(400).json({ error: 'Verification session is required' });
        }

        const decoded = jwt.verify(pendingToken, JWT_SECRET);
        if (decoded.purpose !== 'login-2fa') {
            return res.status(400).json({ error: 'Invalid verification session' });
        }

        const [users] = await pool.query(
            'SELECT user_id, email, recovery_email, two_factor_enabled FROM users WHERE user_id = ?',
            [decoded.userId]
        );
        if (users.length === 0 || !users[0].two_factor_enabled) {
            return res.status(400).json({ error: 'Two-step verification is not enabled for this account' });
        }

        const user = users[0];
        const code = generateOtpCode();
        const expiresAt = withMinutesFromNow(OTP_TTL_MINUTES);
        const destination = user.recovery_email || user.email;
        const deliveryMode = await sendSecurityMail({
            to: destination,
            subject: 'TradeVault sign-in verification code',
            title: 'Here is your new TradeVault sign-in code',
            message: `Use this refreshed code to complete your sign-in. It was sent to ${maskEmail(destination)}.`,
            code,
        });

        await pool.query(
            'UPDATE users SET login_otp_hash = ?, login_otp_expires_at = ? WHERE user_id = ?',
            [hashCode(code), expiresAt, user.user_id]
        );

        res.json({
            success: true,
            deliveryHint: maskEmail(destination),
            deliveryMode,
        });
    } catch (err) {
        if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Verification session expired. Please sign in again.' });
        }
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/request-recovery', async (req, res) => {
    try {
        const { email } = req.body;
        const normalizedEmail = String(email || '').trim().toLowerCase();
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const [users] = await pool.query(
            'SELECT user_id, email, recovery_email FROM users WHERE email = ?',
            [normalizedEmail]
        );

        if (users.length > 0) {
            const user = users[0];
            const code = generateOtpCode();
            const expiresAt = withMinutesFromNow(PASSWORD_RESET_TTL_MINUTES);
            const destination = user.recovery_email || user.email;

            await pool.query(
                'UPDATE users SET reset_otp_hash = ?, reset_otp_expires_at = ? WHERE user_id = ?',
                [hashCode(code), expiresAt, user.user_id]
            );

            await sendSecurityMail({
                to: destination,
                subject: 'TradeVault password reset code',
                title: 'Reset your TradeVault password',
                message: `Use this code to recover your TradeVault account. It was delivered to ${maskEmail(destination)}.`,
                code,
            });
        }

        res.json({
            success: true,
            message: 'If an account exists for that email, a recovery code has been sent.',
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { email, code, newPassword } = req.body;
        const normalizedEmail = String(email || '').trim().toLowerCase();
        if (!email || !code || !newPassword) {
            return res.status(400).json({ error: 'Email, recovery code, and new password are required' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const [users] = await pool.query(
            'SELECT user_id, reset_otp_hash, reset_otp_expires_at FROM users WHERE email = ?',
            [normalizedEmail]
        );
        if (users.length === 0) {
            return res.status(400).json({ error: 'Invalid recovery request' });
        }

        const user = users[0];
        const isExpired = !user.reset_otp_expires_at || new Date(user.reset_otp_expires_at).getTime() < Date.now();
        if (!user.reset_otp_hash || isExpired) {
            return res.status(400).json({ error: 'This recovery code has expired. Request a new one.' });
        }

        if (hashCode(code.trim()) !== user.reset_otp_hash) {
            return res.status(401).json({ error: 'Invalid recovery code' });
        }

        const passwordHash = await bcrypt.hash(newPassword, 12);
        await pool.query(
            `UPDATE users
             SET password_hash = ?, reset_otp_hash = NULL, reset_otp_expires_at = NULL,
                 login_otp_hash = NULL, login_otp_expires_at = NULL
             WHERE user_id = ?`,
            [passwordHash, user.user_id]
        );

        res.json({ success: true, message: 'Password updated successfully. You can sign in now.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== AUTH MIDDLEWARE ==========

function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.userId;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

// Apply auth middleware to all /api routes except auth
app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/auth/')) return next();
    return authMiddleware(req, res, next);
});

app.get('/api/security/status', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT email, recovery_email, two_factor_enabled FROM users WHERE user_id = ?',
            [req.userId]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'User not found' });

        const user = rows[0];
        const destination = user.recovery_email || user.email;

        res.json({
            twoFactorEnabled: Boolean(user.two_factor_enabled),
            recoveryEmail: user.recovery_email || '',
            recoveryDestinationMasked: maskEmail(destination),
            mailDeliveryMode: mailTransport ? 'email' : 'console',
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/security/settings', async (req, res) => {
    try {
        const { currentPassword, recoveryEmail, twoFactorEnabled } = req.body;
        if (!currentPassword) {
            return res.status(400).json({ error: 'Current password is required to update security settings' });
        }

        const [rows] = await pool.query(
            'SELECT user_id, email, password_hash FROM users WHERE user_id = ?',
            [req.userId]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'User not found' });

        const user = rows[0];
        const valid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        const normalizedRecoveryEmail = recoveryEmail && recoveryEmail.trim()
            ? recoveryEmail.trim().toLowerCase()
            : null;

        await pool.query(
            `UPDATE users
             SET recovery_email = ?, two_factor_enabled = ?, login_otp_hash = NULL, login_otp_expires_at = NULL
             WHERE user_id = ?`,
            [normalizedRecoveryEmail, twoFactorEnabled ? 1 : 0, req.userId]
        );

        const destination = normalizedRecoveryEmail || user.email;
        res.json({
            success: true,
            twoFactorEnabled: Boolean(twoFactorEnabled),
            recoveryEmail: normalizedRecoveryEmail || '',
            recoveryDestinationMasked: maskEmail(destination),
            mailDeliveryMode: mailTransport ? 'email' : 'console',
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/strategies', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM strategies WHERE user_id = ? ORDER BY strategy_name',
            [req.userId]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/strategies', async (req, res) => {
    try {
        const { strategy_name, timeframe, description, risk_per_trade } = req.body;
        const [result] = await pool.query(
            'INSERT INTO strategies (user_id, strategy_name, timeframe, description, risk_per_trade) VALUES (?, ?, ?, ?, ?)',
            [req.userId, strategy_name, timeframe || null, description || null, risk_per_trade || 1.0]
        );
        const [rows] = await pool.query('SELECT * FROM strategies WHERE strategy_id = ?', [result.insertId]);
        res.status(201).json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/strategies/:id', async (req, res) => {
    try {
        const { strategy_name, timeframe, description, risk_per_trade } = req.body;
        await pool.query(
            'UPDATE strategies SET strategy_name=?, timeframe=?, description=?, risk_per_trade=? WHERE strategy_id=? AND user_id=?',
            [strategy_name, timeframe || null, description || null, risk_per_trade || 1.0, req.params.id, req.userId]
        );
        const [rows] = await pool.query('SELECT * FROM strategies WHERE strategy_id = ?', [req.params.id]);
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/strategies/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM strategies WHERE strategy_id=? AND user_id=?', [req.params.id, req.userId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== TRADES ==========

app.get('/api/trades', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT t.*, s.strategy_name 
       FROM trades t 
       LEFT JOIN strategies s ON t.strategy_id = s.strategy_id 
       WHERE t.user_id = ? 
       ORDER BY t.trade_date DESC, t.created_at DESC`,
            [req.userId]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/trades/:id', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT t.*, s.strategy_name 
       FROM trades t 
       LEFT JOIN strategies s ON t.strategy_id = s.strategy_id 
       WHERE t.trade_id = ? AND t.user_id = ?`,
            [req.params.id, req.userId]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Trade not found' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/trades', async (req, res) => {
    try {
        const t = req.body;
        const pnl = t.direction === 'BUY'
            ? ((t.exit_price || 0) - t.entry_price) * t.position_size
            : (t.entry_price - (t.exit_price || 0)) * t.position_size;
        const result = pnl > 0 ? 'WIN' : pnl < 0 ? 'LOSS' : 'BE';

        const [ins] = await pool.query(
            `INSERT INTO trades 
        (user_id, strategy_id, symbol, asset_class, entry_price, exit_price, position_size, 
         stop_loss, take_profit, direction, result, pnl, rr_ratio, confidence_rating, trade_date, notes) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.userId, t.strategy_id || null, t.symbol, t.asset_class || 'stock',
                t.entry_price, t.exit_price || null, t.position_size,
                t.stop_loss || null, t.take_profit || null, t.direction || 'BUY',
                t.exit_price != null ? result : null,
                t.exit_price != null ? pnl : 0,
                t.rr_ratio || null, t.confidence_rating || null, t.trade_date, t.notes || null,
            ]
        );
        const [rows] = await pool.query(
            `SELECT t.*, s.strategy_name FROM trades t LEFT JOIN strategies s ON t.strategy_id = s.strategy_id WHERE t.trade_id = ?`,
            [ins.insertId]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/trades/:id', async (req, res) => {
    try {
        const t = req.body;
        const pnl = t.direction === 'BUY'
            ? ((t.exit_price || 0) - t.entry_price) * t.position_size
            : (t.entry_price - (t.exit_price || 0)) * t.position_size;
        const result = pnl > 0 ? 'WIN' : pnl < 0 ? 'LOSS' : 'BE';

        await pool.query(
            `UPDATE trades SET 
        strategy_id=?, symbol=?, asset_class=?, entry_price=?, exit_price=?, position_size=?,
        stop_loss=?, take_profit=?, direction=?, result=?, pnl=?, rr_ratio=?, 
        confidence_rating=?, trade_date=?, notes=?
       WHERE trade_id=? AND user_id=?`,
            [
                t.strategy_id || null, t.symbol, t.asset_class || 'stock',
                t.entry_price, t.exit_price || null, t.position_size,
                t.stop_loss || null, t.take_profit || null, t.direction || 'BUY',
                t.exit_price != null ? result : null,
                t.exit_price != null ? pnl : 0,
                t.rr_ratio || null, t.confidence_rating || null, t.trade_date, t.notes || null,
                req.params.id, req.userId,
            ]
        );
        const [rows] = await pool.query(
            `SELECT t.*, s.strategy_name FROM trades t LEFT JOIN strategies s ON t.strategy_id = s.strategy_id WHERE t.trade_id = ?`,
            [req.params.id]
        );
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/trades/:id', async (req, res) => {
    try {
        // Delete associated screenshots files
        const [screenshots] = await pool.query('SELECT image_path FROM screenshots WHERE trade_id=?', [req.params.id]);
        for (const s of screenshots) {
            const filePath = path.join(__dirname, s.image_path);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        await pool.query('DELETE FROM trades WHERE trade_id=? AND user_id=?', [req.params.id, req.userId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== STATS ==========

app.get('/api/stats', async (req, res) => {
    try {
        const [trades] = await pool.query(
            'SELECT pnl, result, rr_ratio FROM trades WHERE user_id = ? AND exit_price IS NOT NULL',
            [req.userId]
        );
        const total = trades.length;
        if (total === 0) {
            return res.json({ totalPnl: 0, winRate: 0, totalTrades: 0, bestTrade: 0, worstTrade: 0, avgPnl: 0, avgRR: 0 });
        }
        const pnls = trades.map(t => parseFloat(t.pnl));
        const wins = trades.filter(t => t.result === 'WIN').length;
        const rrs = trades.filter(t => t.rr_ratio != null).map(t => parseFloat(t.rr_ratio));

        res.json({
            totalPnl: pnls.reduce((a, b) => a + b, 0),
            winRate: Math.round((wins / total) * 100),
            totalTrades: total,
            bestTrade: Math.max(...pnls),
            worstTrade: Math.min(...pnls),
            avgPnl: pnls.reduce((a, b) => a + b, 0) / total,
            avgRR: rrs.length > 0 ? rrs.reduce((a, b) => a + b, 0) / rrs.length : 0,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== EXECUTION LOG ==========

app.get('/api/trades/:id/executions', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM trade_execution_log WHERE trade_id = ? ORDER BY execution_time',
            [req.params.id]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/trades/:id/executions', async (req, res) => {
    try {
        const { execution_time, execution_price, quantity } = req.body;
        const [result] = await pool.query(
            'INSERT INTO trade_execution_log (trade_id, execution_time, execution_price, quantity) VALUES (?, ?, ?, ?)',
            [req.params.id, execution_time, execution_price, quantity]
        );
        const [rows] = await pool.query('SELECT * FROM trade_execution_log WHERE execution_id = ?', [result.insertId]);
        res.status(201).json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/executions/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM trade_execution_log WHERE execution_id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== MARKET CONDITIONS ==========

app.get('/api/trades/:id/conditions', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM market_conditions WHERE trade_id = ?', [req.params.id]);
        res.json(rows[0] || null);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/trades/:id/conditions', async (req, res) => {
    try {
        const { trend, volatility_index, news_event, session } = req.body;
        const [existing] = await pool.query('SELECT condition_id FROM market_conditions WHERE trade_id = ?', [req.params.id]);

        if (existing.length > 0) {
            await pool.query(
                'UPDATE market_conditions SET trend=?, volatility_index=?, news_event=?, session=? WHERE trade_id=?',
                [trend, volatility_index || null, news_event || false, session || 'Other', req.params.id]
            );
        } else {
            await pool.query(
                'INSERT INTO market_conditions (trade_id, trend, volatility_index, news_event, session) VALUES (?, ?, ?, ?, ?)',
                [req.params.id, trend, volatility_index || null, news_event || false, session || 'Other']
            );
        }
        const [rows] = await pool.query('SELECT * FROM market_conditions WHERE trade_id = ?', [req.params.id]);
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== SCREENSHOTS ==========

app.get('/api/trades/:id/screenshots', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM screenshots WHERE trade_id = ? ORDER BY uploaded_at DESC',
            [req.params.id]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/trades/:id/screenshots', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const imagePath = `/uploads/${req.file.filename}`;
        const [result] = await pool.query(
            'INSERT INTO screenshots (trade_id, image_path) VALUES (?, ?)',
            [req.params.id, imagePath]
        );
        const [rows] = await pool.query('SELECT * FROM screenshots WHERE screenshot_id = ?', [result.insertId]);
        res.status(201).json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/screenshots/:id', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT image_path FROM screenshots WHERE screenshot_id = ?', [req.params.id]);
        if (rows.length > 0) {
            const filePath = path.join(__dirname, rows[0].image_path);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        await pool.query('DELETE FROM screenshots WHERE screenshot_id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== RL SUGGESTIONS ==========

app.get('/api/suggestions', async (req, res) => {
    try {
        // Get all completed trades with their market conditions
        const [trades] = await pool.query(
            `SELECT t.*, mc.trend, mc.volatility_index, mc.news_event, mc.session AS mc_session
             FROM trades t
             LEFT JOIN market_conditions mc ON t.trade_id = mc.trade_id
             WHERE t.user_id = ? AND t.exit_price IS NOT NULL`,
            [req.userId]
        );

        if (trades.length < 3) {
            return res.json({
                suggestions: [],
                message: 'Need at least 3 completed trades with exit prices to generate suggestions. Keep logging your trades!'
            });
        }

        // Attach conditions to trades for the RL engine
        const tradesWithConditions = trades.map(t => ({
            ...t,
            _condition: {
                trend: t.trend || 'range',
                session: t.mc_session || 'Other',
            }
        }));

        // Train RL engine
        const engine = new RLEngine({ episodes: 100, learningRate: 0.15, discountFactor: 0.9 });
        engine.train(tradesWithConditions);
        const analysis = engine.getFullAnalysis();

        // Build human-readable suggestions
        const formatSuggestion = (s) => ({
            direction: s.state.direction,
            asset: s.state.asset,
            trend: s.state.trend,
            session: s.state.session,
            confidence: s.state.confidence,
            score: Math.round(s.confidence),
            qValue: parseFloat(s.qValue.toFixed(4)),
            recommendation: s.recommendation,
            description: `${s.state.direction} ${s.state.asset} in ${s.state.trend} ${s.state.session} session` +
                (s.state.confidence !== 'none' ? ` (${s.state.confidence} confidence)` : ''),
        });

        res.json({
            suggestions: analysis.favorable.map(formatSuggestion),
            neutral: analysis.neutral.map(formatSuggestion),
            avoid: analysis.avoid.map(formatSuggestion),
            totalTradesAnalyzed: trades.length,
            message: null,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== QUANT STRATEGIES LIBRARY ==========

app.get('/api/quant-strategies', (req, res) => {
    const category = req.query.category;
    let results = QUANT_STRATEGIES;
    if (category && category !== 'all') {
        results = results.filter(s => s.category.toLowerCase() === category.toLowerCase());
    }
    res.json(results);
});

// ========== RL MODEL BACKTEST ==========

app.get('/api/rl-backtest', (req, res) => {
    const resultsPath = path.join(__dirname, 'rl_model', 'results', 'backtest.json');
    if (!fs.existsSync(resultsPath)) {
        return res.status(404).json({
            error: 'No backtest results found. Run: python rl_model/train.py',
            summary: null,
            yearly: [],
            equity_curves: {},
        });
    }
    try {
        const data = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Failed to parse backtest results: ' + err.message });
    }
});

app.get('/api/rl-model-info', (req, res) => {
    const resultsPath = path.join(__dirname, 'rl_model', 'results', 'backtest.json');
    if (!fs.existsSync(resultsPath)) {
        return res.json({ trained: false, message: 'Model not yet trained.' });
    }
    try {
        const data = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
        res.json({
            trained: true,
            training: data.training || {},
            summary: data.summary || {},
        });
    } catch (err) {
        res.json({ trained: false, message: err.message });
    }
});

// ========== START ==========

const httpServer = http.createServer(app);

httpServer.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
        console.error(`\n  ❌ Port ${PORT} is already in use.`);
        console.error(`  Try one of these commands:`);
        console.error(`  1. lsof -iTCP:${PORT} -sTCP:LISTEN -n -P`);
        console.error(`  2. kill <PID>`);
        console.error(`  3. PORT=${PORT + 1} npm start\n`);
        process.exitCode = 1;
        return;
    }

    console.error('\n  ❌ Server failed to start:', err.message);
    process.exitCode = 1;
});

httpServer.listen(PORT, () => {
    new LiveSignalEngine(httpServer);
    console.log(`\n  🚀 TradeVault server running at http://localhost:${PORT}`);
    console.log(`  📡 WebSocket live signals at ws://localhost:${PORT}/ws`);
    console.log(`  ✉️ Recovery email delivery: ${mailTransport ? 'SMTP configured' : 'console fallback'}\n`);
});
