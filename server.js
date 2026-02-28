const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db/connection');
const RLEngine = require('./rl/engine');
const QUANT_STRATEGIES = require('./rl/quant-strategies');
const LiveSignalEngine = require('./rl/live-signals');
const http = require('http');

const app = express();
const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'tradevault_secret_key_change_in_production';

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

// DB migration: ensure password_hash column exists
(async () => {
    try {
        const [cols] = await pool.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
             WHERE TABLE_SCHEMA = 'tradevault' AND TABLE_NAME = 'users' AND COLUMN_NAME = 'password_hash'`
        );
        if (cols.length === 0) {
            await pool.query('ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NOT NULL DEFAULT \'\'  AFTER email');
            console.log('  ✅ Added password_hash column to users table');
        }
    } catch (e) {
        console.log('  ⚠ Migration check skipped:', e.message);
    }
})();

app.post('/api/auth/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email, and password are required' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        // Check if email already exists
        const [existing] = await pool.query('SELECT user_id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(409).json({ error: 'An account with this email already exists' });
        }

        // Hash password and create user
        const password_hash = await bcrypt.hash(password, 12);
        const [result] = await pool.query(
            'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
            [name, email, password_hash]
        );

        const token = jwt.sign({ userId: result.insertId, email }, JWT_SECRET, { expiresIn: '30d' });

        res.status(201).json({
            token,
            user: { user_id: result.insertId, name, email },
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const user = users[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const token = jwt.sign({ userId: user.user_id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });

        res.json({
            token,
            user: { user_id: user.user_id, name: user.name, email: user.email },
        });
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
const signalEngine = new LiveSignalEngine(httpServer);

httpServer.listen(PORT, () => {
    console.log(`\n  🚀 TradeVault server running at http://localhost:${PORT}`);
    console.log(`  📡 WebSocket live signals at ws://localhost:${PORT}/ws\n`);
});
