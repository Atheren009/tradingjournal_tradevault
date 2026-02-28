/* ============================================
   TradeVault — Live Strategy Signal Engine
   Connects to Binance WebSocket for real-time
   crypto data and generates BUY/SELL signals
   ============================================ */

const WebSocket = require('ws');

class LiveSignalEngine {
    constructor(server) {
        this.wss = new WebSocket.Server({ server, path: '/ws' });
        this.clients = new Set();
        this.binanceSockets = {};
        this.candles = {};           // symbol -> array of candles
        this.activeStrategies = {};  // symbol -> [strategy configs]
        this.lastSignals = {};       // symbol -> last signal to avoid spam

        this.wss.on('connection', (ws) => {
            this.clients.add(ws);
            ws.on('close', () => this.clients.delete(ws));
            ws.on('message', (msg) => this._handleClientMessage(ws, JSON.parse(msg)));
            // Send current state
            ws.send(JSON.stringify({ type: 'connected', symbols: Object.keys(this.binanceSockets) }));
        });
    }

    // Broadcast to all connected clients
    broadcast(data) {
        const msg = JSON.stringify(data);
        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) client.send(msg);
        }
    }

    // Handle messages from frontend clients
    _handleClientMessage(ws, msg) {
        switch (msg.type) {
            case 'subscribe':
                this.subscribe(msg.symbol, msg.strategies || ['sma_crossover', 'rsi', 'breakout', 'hft_momentum', 'linear_regression']);
                break;
            case 'unsubscribe':
                this.unsubscribe(msg.symbol);
                break;
        }
    }

    // Subscribe to a Binance kline WebSocket for a symbol
    subscribe(symbol, strategies) {
        const sym = symbol.toLowerCase().replace('/', '');
        if (this.binanceSockets[sym]) return; // Already subscribed

        this.candles[sym] = [];
        this.activeStrategies[sym] = strategies;
        this.lastSignals[sym] = {};

        // Fetch initial candles (1m klines, last 200)
        this._fetchInitialCandles(sym).then(() => {
            // Connect to Binance WebSocket for live klines
            const wsUrl = `wss://stream.binance.com:9443/ws/${sym}@kline_1m`;
            const binanceWs = new WebSocket(wsUrl);

            binanceWs.on('open', () => {
                this.binanceSockets[sym] = binanceWs;
                this.broadcast({
                    type: 'subscribed',
                    symbol: sym.toUpperCase(),
                    candleCount: this.candles[sym].length,
                });
                console.log(`  📡 Subscribed to ${sym.toUpperCase()} live feed`);
            });

            binanceWs.on('message', (raw) => {
                try {
                    const data = JSON.parse(raw);
                    this._processKline(sym, data.k);
                } catch (e) { /* ignore parse errors */ }
            });

            binanceWs.on('error', (err) => {
                console.error(`  ❌ Binance WS error for ${sym}:`, err.message);
            });

            binanceWs.on('close', () => {
                delete this.binanceSockets[sym];
                // Auto-reconnect after 5s
                setTimeout(() => {
                    if (this.activeStrategies[sym]) {
                        console.log(`  🔄 Reconnecting ${sym.toUpperCase()}...`);
                        delete this.binanceSockets[sym];
                        this.subscribe(sym, this.activeStrategies[sym]);
                    }
                }, 5000);
            });
        });
    }

    unsubscribe(symbol) {
        const sym = symbol.toLowerCase().replace('/', '');
        if (this.binanceSockets[sym]) {
            this.binanceSockets[sym].close();
            delete this.binanceSockets[sym];
        }
        delete this.candles[sym];
        delete this.activeStrategies[sym];
        delete this.lastSignals[sym];
        this.broadcast({ type: 'unsubscribed', symbol: sym.toUpperCase() });
    }

    // Fetch initial candle history from Binance REST
    async _fetchInitialCandles(sym) {
        try {
            const url = `https://api.binance.com/api/v3/klines?symbol=${sym.toUpperCase()}&interval=1m&limit=200`;
            const res = await fetch(url);
            const data = await res.json();
            this.candles[sym] = data.map(k => ({
                time: k[0],
                open: parseFloat(k[1]),
                high: parseFloat(k[2]),
                low: parseFloat(k[3]),
                close: parseFloat(k[4]),
                volume: parseFloat(k[5]),
                closed: true,
            }));
        } catch (e) {
            console.error(`  ⚠ Failed to fetch initial candles for ${sym}:`, e.message);
            this.candles[sym] = [];
        }
    }

    // Process a live kline from Binance
    _processKline(sym, kline) {
        if (!kline) return;

        const candle = {
            time: kline.t,
            open: parseFloat(kline.o),
            high: parseFloat(kline.h),
            low: parseFloat(kline.l),
            close: parseFloat(kline.c),
            volume: parseFloat(kline.v),
            closed: kline.x,
        };

        // Update or append candle
        const candles = this.candles[sym];
        if (candles.length > 0 && candles[candles.length - 1].time === candle.time) {
            candles[candles.length - 1] = candle;
        } else if (candle.closed || candles.length === 0) {
            candles.push(candle);
            if (candles.length > 500) candles.shift(); // Keep last 500
        }

        // Broadcast live price
        this.broadcast({
            type: 'price',
            symbol: sym.toUpperCase(),
            price: candle.close,
            high: candle.high,
            low: candle.low,
            volume: candle.volume,
            time: candle.time,
        });

        // Run strategy signals on closed candles
        if (candle.closed && candles.length >= 50) {
            const strategies = this.activeStrategies[sym] || [];
            for (const strat of strategies) {
                const signal = this._runStrategy(strat, sym, candles);
                if (signal && this._isNewSignal(sym, strat, signal)) {
                    this.lastSignals[sym][strat] = signal;
                    this.broadcast({
                        type: 'signal',
                        symbol: sym.toUpperCase(),
                        strategy: strat,
                        ...signal,
                        time: Date.now(),
                    });
                }
            }
        }
    }

    _isNewSignal(sym, strat, signal) {
        const last = this.lastSignals[sym]?.[strat];
        if (!last) return true;
        return last.action !== signal.action;
    }

    // ========== STRATEGY IMPLEMENTATIONS ==========

    _runStrategy(name, sym, candles) {
        switch (name) {
            case 'sma_crossover': return this._smaCrossover(candles);
            case 'rsi': return this._rsiStrategy(candles);
            case 'breakout': return this._breakoutStrategy(candles);
            case 'hft_momentum': return this._hftMomentum(candles);
            case 'linear_regression': return this._linearRegression(candles);
            default: return null;
        }
    }

    // --- SMA Crossover (10 & 30 period) ---
    _smaCrossover(candles) {
        const closes = candles.map(c => c.close);
        const sma10 = this._sma(closes, 10);
        const sma30 = this._sma(closes, 30);
        if (sma10.length < 2 || sma30.length < 2) return null;

        const curr10 = sma10[sma10.length - 1];
        const prev10 = sma10[sma10.length - 2];
        const curr30 = sma30[sma30.length - 1];
        const prev30 = sma30[sma30.length - 2];

        if (prev10 <= prev30 && curr10 > curr30) {
            return {
                action: 'BUY',
                reason: `SMA(10) crossed above SMA(30) — bullish crossover`,
                sma10: curr10.toFixed(2),
                sma30: curr30.toFixed(2),
                strength: Math.min(((curr10 - curr30) / curr30) * 1000, 100),
            };
        } else if (prev10 >= prev30 && curr10 < curr30) {
            return {
                action: 'SELL',
                reason: `SMA(10) crossed below SMA(30) — bearish crossover`,
                sma10: curr10.toFixed(2),
                sma30: curr30.toFixed(2),
                strength: Math.min(((curr30 - curr10) / curr10) * 1000, 100),
            };
        }

        // Trend confirmation (not a crossover but strong trend)
        if (curr10 > curr30 * 1.002) {
            return { action: 'BUY', reason: `SMA(10) ${curr10.toFixed(2)} above SMA(30) ${curr30.toFixed(2)} — bullish trend`, sma10: curr10.toFixed(2), sma30: curr30.toFixed(2), strength: 40 };
        } else if (curr10 < curr30 * 0.998) {
            return { action: 'SELL', reason: `SMA(10) ${curr10.toFixed(2)} below SMA(30) ${curr30.toFixed(2)} — bearish trend`, sma10: curr10.toFixed(2), sma30: curr30.toFixed(2), strength: 40 };
        }
        return { action: 'HOLD', reason: `SMA(10) ≈ SMA(30) — no clear trend`, sma10: curr10.toFixed(2), sma30: curr30.toFixed(2), strength: 10 };
    }

    // --- RSI Strategy (14-period) ---
    _rsiStrategy(candles) {
        const closes = candles.map(c => c.close);
        const rsi = this._rsi(closes, 14);
        if (rsi === null) return null;

        if (rsi <= 25) {
            return { action: 'BUY', reason: `RSI(14) = ${rsi.toFixed(1)} — deeply oversold, strong buy signal`, rsi: rsi.toFixed(1), strength: 90 };
        } else if (rsi <= 30) {
            return { action: 'BUY', reason: `RSI(14) = ${rsi.toFixed(1)} — oversold territory`, rsi: rsi.toFixed(1), strength: 70 };
        } else if (rsi >= 75) {
            return { action: 'SELL', reason: `RSI(14) = ${rsi.toFixed(1)} — deeply overbought, strong sell signal`, rsi: rsi.toFixed(1), strength: 90 };
        } else if (rsi >= 70) {
            return { action: 'SELL', reason: `RSI(14) = ${rsi.toFixed(1)} — overbought territory`, rsi: rsi.toFixed(1), strength: 70 };
        }
        return { action: 'HOLD', reason: `RSI(14) = ${rsi.toFixed(1)} — neutral zone`, rsi: rsi.toFixed(1), strength: 10 };
    }

    // --- Breakout Strategy (20-period high/low) ---
    _breakoutStrategy(candles) {
        if (candles.length < 21) return null;
        const recent = candles.slice(-21, -1); // Last 20 candles (excluding current)
        const current = candles[candles.length - 1];

        const high20 = Math.max(...recent.map(c => c.high));
        const low20 = Math.min(...recent.map(c => c.low));
        const range = high20 - low20;

        if (current.close > high20) {
            return {
                action: 'BUY',
                reason: `Price broke above 20-period high $${high20.toFixed(2)} — breakout buy`,
                level: high20.toFixed(2),
                strength: Math.min(((current.close - high20) / range) * 200, 100),
            };
        } else if (current.close < low20) {
            return {
                action: 'SELL',
                reason: `Price broke below 20-period low $${low20.toFixed(2)} — breakdown sell`,
                level: low20.toFixed(2),
                strength: Math.min(((low20 - current.close) / range) * 200, 100),
            };
        }
        return {
            action: 'HOLD',
            reason: `Price within range [$${low20.toFixed(2)} – $${high20.toFixed(2)}]`,
            level: `${low20.toFixed(2)}-${high20.toFixed(2)}`,
            strength: 10,
        };
    }

    // ========== INDICATOR CALCULATIONS ==========

    _sma(values, period) {
        if (values.length < period) return [];
        const result = [];
        for (let i = period - 1; i < values.length; i++) {
            const sum = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
            result.push(sum / period);
        }
        return result;
    }

    _rsi(values, period) {
        if (values.length < period + 1) return null;
        let gains = 0, losses = 0;

        // Initial average gain/loss
        for (let i = 1; i <= period; i++) {
            const diff = values[i] - values[i - 1];
            if (diff >= 0) gains += diff; else losses -= diff;
        }
        let avgGain = gains / period;
        let avgLoss = losses / period;

        // Smoothed RSI
        for (let i = period + 1; i < values.length; i++) {
            const diff = values[i] - values[i - 1];
            avgGain = (avgGain * (period - 1) + (diff >= 0 ? diff : 0)) / period;
            avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
        }

        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }

    // ========== HFT MOMENTUM STRATEGY ==========
    // Uses VWAP deviation, tick momentum, and micro-price analysis

    _hftMomentum(candles) {
        if (candles.length < 30) return null;

        const recent = candles.slice(-30);
        const current = recent[recent.length - 1];

        // Calculate VWAP
        const vwap = this._vwap(recent);
        const vwapDev = ((current.close - vwap) / vwap) * 100;

        // Tick momentum — sum of directional price changes over last 10 candles
        const last10 = recent.slice(-10);
        let tickMomentum = 0;
        for (let i = 1; i < last10.length; i++) {
            tickMomentum += last10[i].close - last10[i - 1].close;
        }
        const tickDir = tickMomentum > 0 ? 1 : -1;

        // Micro-price: weighted mid-price approximation
        const microPrice = (current.high + current.low + current.close * 2) / 4;
        const microDev = ((current.close - microPrice) / microPrice) * 10000; // in bps

        // Volume surge detection
        const avgVol = recent.slice(0, -1).reduce((s, c) => s + c.volume, 0) / (recent.length - 1);
        const volRatio = current.volume / (avgVol || 1);

        // Combined HFT signal
        if (vwapDev < -0.15 && tickDir > 0 && volRatio > 1.3) {
            return {
                action: 'BUY',
                reason: `HFT: Price ${vwapDev.toFixed(2)}% below VWAP with positive tick momentum, volume surge ${volRatio.toFixed(1)}x`,
                vwap: vwap.toFixed(2),
                strength: Math.min(Math.abs(vwapDev) * 200 + volRatio * 10, 100),
            };
        } else if (vwapDev > 0.15 && tickDir < 0 && volRatio > 1.3) {
            return {
                action: 'SELL',
                reason: `HFT: Price ${vwapDev.toFixed(2)}% above VWAP with negative tick momentum, volume surge ${volRatio.toFixed(1)}x`,
                vwap: vwap.toFixed(2),
                strength: Math.min(Math.abs(vwapDev) * 200 + volRatio * 10, 100),
            };
        }

        return {
            action: 'HOLD',
            reason: `HFT: VWAP dev ${vwapDev.toFixed(2)}%, tick ${tickDir > 0 ? '+' : '-'}, vol ratio ${volRatio.toFixed(1)}x — no signal`,
            vwap: vwap.toFixed(2),
            strength: 10,
        };
    }

    _vwap(candles) {
        let cumPV = 0, cumVol = 0;
        for (const c of candles) {
            const typicalPrice = (c.high + c.low + c.close) / 3;
            cumPV += typicalPrice * c.volume;
            cumVol += c.volume;
        }
        return cumVol > 0 ? cumPV / cumVol : candles[candles.length - 1].close;
    }

    // ========== JIM SIMONS LINEAR REGRESSION STRATEGY ==========
    // Rolling linear regression on price — trade slope reversals

    _linearRegression(candles) {
        if (candles.length < 50) return null;

        const closes = candles.slice(-50).map(c => c.close);

        // Short-term regression (20 periods)
        const shortSlope = this._linearRegSlope(closes.slice(-20));
        // Long-term regression (50 periods)
        const longSlope = this._linearRegSlope(closes);

        // Normalize slopes as percentage per bar
        const avgPrice = closes.reduce((a, b) => a + b, 0) / closes.length;
        const shortSlopeNorm = (shortSlope / avgPrice) * 100;
        const longSlopeNorm = (longSlope / avgPrice) * 100;

        // R-squared for confidence
        const rSquared = this._rSquared(closes.slice(-20));

        // Signal: strong short-term slope with high R² in direction of long-term trend
        if (shortSlopeNorm > 0.05 && longSlopeNorm > 0 && rSquared > 0.6) {
            return {
                action: 'BUY',
                reason: `LR: Short slope +${shortSlopeNorm.toFixed(3)}%/bar, long slope +${longSlopeNorm.toFixed(3)}%/bar, R²=${rSquared.toFixed(2)} — strong uptrend`,
                strength: Math.min(rSquared * 100, 100),
            };
        } else if (shortSlopeNorm < -0.05 && longSlopeNorm < 0 && rSquared > 0.6) {
            return {
                action: 'SELL',
                reason: `LR: Short slope ${shortSlopeNorm.toFixed(3)}%/bar, long slope ${longSlopeNorm.toFixed(3)}%/bar, R²=${rSquared.toFixed(2)} — strong downtrend`,
                strength: Math.min(rSquared * 100, 100),
            };
        }

        // Mean reversion signal: short-term reversal against long-term
        if (shortSlopeNorm > 0.1 && longSlopeNorm < -0.02) {
            return {
                action: 'SELL',
                reason: `LR Mean Reversion: Short-term bounce (${shortSlopeNorm.toFixed(3)}%/bar) in long-term downtrend — sell the rally`,
                strength: Math.min(Math.abs(shortSlopeNorm) * 300, 80),
            };
        } else if (shortSlopeNorm < -0.1 && longSlopeNorm > 0.02) {
            return {
                action: 'BUY',
                reason: `LR Mean Reversion: Short-term dip (${shortSlopeNorm.toFixed(3)}%/bar) in long-term uptrend — buy the dip`,
                strength: Math.min(Math.abs(shortSlopeNorm) * 300, 80),
            };
        }

        return {
            action: 'HOLD',
            reason: `LR: Slope short=${shortSlopeNorm.toFixed(3)}%, long=${longSlopeNorm.toFixed(3)}%, R²=${rSquared.toFixed(2)} — no clear signal`,
            strength: 10,
        };
    }

    _linearRegSlope(values) {
        const n = values.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
        for (let i = 0; i < n; i++) {
            sumX += i;
            sumY += values[i];
            sumXY += i * values[i];
            sumX2 += i * i;
        }
        return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    }

    _rSquared(values) {
        const n = values.length;
        const slope = this._linearRegSlope(values);
        const meanY = values.reduce((a, b) => a + b, 0) / n;
        const intercept = meanY - slope * (n - 1) / 2;

        let ssRes = 0, ssTot = 0;
        for (let i = 0; i < n; i++) {
            const predicted = intercept + slope * i;
            ssRes += (values[i] - predicted) ** 2;
            ssTot += (values[i] - meanY) ** 2;
        }
        return ssTot > 0 ? 1 - (ssRes / ssTot) : 0;
    }
}

module.exports = LiveSignalEngine;
