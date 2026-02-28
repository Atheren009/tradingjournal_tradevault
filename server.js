const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const pool = require('./db/connection');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

// ========== STRATEGIES ==========

app.get('/api/strategies', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM strategies WHERE user_id = ? ORDER BY strategy_name',
            [1]
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
            [1, strategy_name, timeframe || null, description || null, risk_per_trade || 1.0]
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
            [strategy_name, timeframe || null, description || null, risk_per_trade || 1.0, req.params.id, 1]
        );
        const [rows] = await pool.query('SELECT * FROM strategies WHERE strategy_id = ?', [req.params.id]);
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/strategies/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM strategies WHERE strategy_id=? AND user_id=?', [req.params.id, 1]);
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
            [1]
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
            [req.params.id, 1]
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
                1, t.strategy_id || null, t.symbol, t.asset_class || 'stock',
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
                req.params.id, 1,
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
        await pool.query('DELETE FROM trades WHERE trade_id=? AND user_id=?', [req.params.id, 1]);
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
            [1]
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

// ========== START ==========

app.listen(PORT, () => {
    console.log(`\n  🚀 TradeVault server running at http://localhost:${PORT}\n`);
});
