/* ============================================
   TradeVault — Q-Learning RL Suggestion Engine
   ============================================ */

class RLEngine {
    constructor(options = {}) {
        this.alpha = options.learningRate || 0.1;       // Learning rate
        this.gamma = options.discountFactor || 0.95;    // Discount factor
        this.epsilon = options.explorationRate || 0.1;  // Exploration rate
        this.episodes = options.episodes || 50;         // Training episodes
        this.qTable = {};                               // State -> action -> Q-value
    }

    // Discretize a trade + market condition into a state key
    _getState(trade, condition) {
        const direction = trade.direction || 'BUY';
        const asset = trade.asset_class || 'stock';
        const trend = condition?.trend || 'range';
        const session = condition?.session || 'Other';
        const confBucket = !trade.confidence_rating ? 'none'
            : trade.confidence_rating <= 2 ? 'low'
                : trade.confidence_rating === 3 ? 'mid'
                    : 'high';

        return `${direction}|${asset}|${trend}|${session}|${confBucket}`;
    }

    // Parse state key back to readable components
    _parseState(stateKey) {
        const [direction, asset, trend, session, confidence] = stateKey.split('|');
        return { direction, asset, trend, session, confidence };
    }

    // Get Q-value for a state-action pair
    _getQ(state, action) {
        if (!this.qTable[state]) this.qTable[state] = {};
        return this.qTable[state][action] || 0;
    }

    // Set Q-value
    _setQ(state, action, value) {
        if (!this.qTable[state]) this.qTable[state] = {};
        this.qTable[state][action] = value;
    }

    // Normalize P&L to a reward between -1 and 1
    _normalizeReward(pnl, allPnls) {
        const maxAbs = Math.max(...allPnls.map(Math.abs), 1);
        return pnl / maxAbs;
    }

    // Train the Q-table from historical trades
    train(tradesWithConditions) {
        if (tradesWithConditions.length === 0) return;

        // Only use completed trades (those with exit price and P&L)
        const completed = tradesWithConditions.filter(t => t.exit_price != null);
        if (completed.length === 0) return;

        const allPnls = completed.map(t => parseFloat(t.pnl) || 0);
        const action = 'trade'; // Single action: whether to trade in this state

        // Run multiple training episodes
        for (let ep = 0; ep < this.episodes; ep++) {
            // Shuffle trades for each episode
            const shuffled = [...completed].sort(() => Math.random() - 0.5);

            for (let i = 0; i < shuffled.length; i++) {
                const trade = shuffled[i];
                const state = this._getState(trade, trade._condition);
                const pnl = parseFloat(trade.pnl) || 0;
                const reward = this._normalizeReward(pnl, allPnls);

                // Next state (if exists)
                const nextTrade = shuffled[i + 1];
                const nextState = nextTrade ? this._getState(nextTrade, nextTrade._condition) : null;
                const nextQ = nextState ? this._getQ(nextState, action) : 0;

                // Q-learning update: Q(s,a) = Q(s,a) + α * [r + γ * max Q(s',a') - Q(s,a)]
                const currentQ = this._getQ(state, action);
                const newQ = currentQ + this.alpha * (reward + this.gamma * nextQ - currentQ);
                this._setQ(state, action, newQ);
            }
        }
    }

    // Get top N suggestions sorted by Q-value
    getSuggestions(topN = 5) {
        const suggestions = [];

        for (const state of Object.keys(this.qTable)) {
            const qValue = this._getQ(state, 'trade');
            const components = this._parseState(state);

            suggestions.push({
                state: components,
                stateKey: state,
                qValue: qValue,
                confidence: Math.min(Math.max((qValue + 1) / 2 * 100, 0), 100), // Map to 0-100%
                recommendation: qValue > 0.1 ? 'FAVORABLE' : qValue < -0.1 ? 'AVOID' : 'NEUTRAL',
            });
        }

        // Sort by Q-value descending (best setups first)
        suggestions.sort((a, b) => b.qValue - a.qValue);
        return suggestions.slice(0, topN);
    }

    // Get a full analysis including avoid states
    getFullAnalysis() {
        const all = this.getSuggestions(100);
        return {
            favorable: all.filter(s => s.recommendation === 'FAVORABLE'),
            neutral: all.filter(s => s.recommendation === 'NEUTRAL'),
            avoid: all.filter(s => s.recommendation === 'AVOID').reverse(), // Worst first
        };
    }
}

module.exports = RLEngine;
