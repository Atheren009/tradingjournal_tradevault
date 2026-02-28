/* ============================================
   Quant Strategies Library
   Curated from published hedge fund & quant papers
   ============================================ */

const QUANT_STRATEGIES = [
    // === MOMENTUM ===
    {
        id: 'momentum-cross',
        name: 'Dual Moving Average Crossover',
        category: 'Momentum',
        difficulty: 'Beginner',
        source: 'Jegadeesh & Titman (1993) — "Returns to Buying Winners and Selling Losers"',
        description: 'Go long when a shorter-period moving average (e.g. 50-day) crosses above a longer-period one (e.g. 200-day). Exit or short when it crosses below. One of the most tested systematic strategies.',
        rules: [
            'Calculate 50-day SMA and 200-day SMA',
            'BUY when SMA50 crosses above SMA200 (Golden Cross)',
            'SELL when SMA50 crosses below SMA200 (Death Cross)',
            'Position size: 2% of portfolio risk per trade',
            'Stop-loss: 1 ATR below entry (for longs)',
        ],
        assets: ['Stocks', 'Forex', 'Crypto', 'Futures'],
        timeframe: 'Daily',
        backtest_note: 'Historically 55-60% win rate with 1.5-2.5 R:R on equity indices.',
    },
    {
        id: 'time-series-momentum',
        name: 'Time Series Momentum (TSMOM)',
        category: 'Momentum',
        difficulty: 'Intermediate',
        source: 'Moskowitz, Ooi & Pedersen (2012) — AQR Capital / Journal of Financial Economics',
        description: 'Trade based on an asset\'s own past returns. If the 12-month return is positive, go long; if negative, go short. Applied across futures markets by AQR and other quant funds.',
        rules: [
            'Calculate trailing 12-month return for each asset',
            'If return > 0 → Long position, scaled by inverse volatility',
            'If return < 0 → Short position, scaled by inverse volatility',
            'Rebalance monthly',
            'Target portfolio volatility: 10-15% annualized',
        ],
        assets: ['Futures', 'Forex', 'Commodities'],
        timeframe: 'Monthly',
        backtest_note: 'Sharpe ratio ~1.0 across 58 futures markets over 25 years. Strong in trending macro regimes.',
    },
    {
        id: 'rsi-mean-reversion',
        name: 'RSI Mean Reversion',
        category: 'Mean Reversion',
        difficulty: 'Beginner',
        source: 'Connors & Alvarez — "Short Term Trading Strategies That Work"',
        description: 'Buy oversold stocks (RSI < 30) in an uptrend, expecting a bounce back. Sell overbought stocks (RSI > 70) in a downtrend.',
        rules: [
            'Only trade stocks above their 200-day SMA (uptrend filter)',
            'BUY when 2-period RSI drops below 10',
            'EXIT when 2-period RSI rises above 70',
            'No shorting in this variant; cash when no signal',
            'Position size: equal-weight across up to 10 positions',
        ],
        assets: ['Stocks', 'ETFs'],
        timeframe: '1D',
        backtest_note: 'Win rate ~80% on S&P 500 stocks with average holding period 3-5 days.',
    },

    // === STATISTICAL ARBITRAGE ===
    {
        id: 'pairs-trading',
        name: 'Pairs Trading (Statistical Arbitrage)',
        category: 'Statistical Arbitrage',
        difficulty: 'Advanced',
        source: 'Gatev, Goetzmann & Rouwenhorst (2006) — Yale ICF / Review of Financial Studies',
        description: 'Identify two cointegrated stocks. When their spread deviates significantly from the mean, short the outperformer and long the underperformer, betting on convergence.',
        rules: [
            'Screen for cointegrated pairs (Engle-Granger test, p < 0.05)',
            'Calculate the z-score of the spread',
            'ENTER when |z-score| > 2.0 (long underperformer, short outperformer)',
            'EXIT when z-score reverts to 0 (or near 0)',
            'STOP-LOSS if |z-score| > 3.5 (spread diverging further)',
        ],
        assets: ['Stocks', 'ETFs'],
        timeframe: '1D',
        backtest_note: 'Sharpe ~0.6-1.2. Market-neutral, profits in low-volatility regimes. Requires careful pair selection.',
    },

    // === FACTOR INVESTING ===
    {
        id: 'fama-french',
        name: 'Fama-French Factor Investing',
        category: 'Factor',
        difficulty: 'Intermediate',
        source: 'Fama & French (1993) — "Common Risk Factors in the Returns on Stocks and Bonds"',
        description: 'Systematically tilt portfolio toward stocks with high book-to-market (value), small market cap (size), and positive momentum. The foundation of modern factor investing used by Dimensional Fund Advisors, AQR, etc.',
        rules: [
            'Screen for Value: top 30% by book-to-market ratio',
            'Screen for Size: bottom 30% by market cap (small caps)',
            'Screen for Momentum: top 30% by 12-1 month return',
            'Equal-weight or risk-parity across selected stocks',
            'Rebalance quarterly',
        ],
        assets: ['Stocks'],
        timeframe: 'Quarterly',
        backtest_note: 'Value + Size + Momentum combined have delivered ~3-5% annual alpha historically.',
    },
    {
        id: 'quality-minus-junk',
        name: 'Quality Minus Junk (QMJ)',
        category: 'Factor',
        difficulty: 'Intermediate',
        source: 'Asness, Frazzini & Pedersen (2019) — AQR Capital / Review of Accounting Studies',
        description: 'Go long high-quality companies (profitable, growing, safe) and short low-quality "junk" companies. Quality is measured by profitability, growth, and safety metrics.',
        rules: [
            'Rank stocks by composite quality score: ROE, earnings growth, low leverage, low earnings variability',
            'LONG top 20% quality stocks',
            'SHORT bottom 20% (junk)',
            'Market-neutral construction',
            'Rebalance monthly',
        ],
        assets: ['Stocks'],
        timeframe: 'Monthly',
        backtest_note: 'Significant alpha globally. Quality stocks also act as a hedge during market crashes.',
    },

    // === VOLATILITY ===
    {
        id: 'vol-risk-premium',
        name: 'Volatility Risk Premium Harvesting',
        category: 'Volatility',
        difficulty: 'Advanced',
        source: 'Carr & Wu (2009) — "Variance Risk Premiums" / Review of Financial Studies',
        description: 'Implied volatility is systematically higher than realized volatility. Sell options (or VIX futures) to capture this premium. Used by hedge funds like Universa (as a hedge) and many vol-arb desks.',
        rules: [
            'Sell short-dated ATM puts or strangles on SPX when VIX > realized vol (20-day)',
            'Size positions so max loss < 5% of portfolio',
            'Hedge with far OTM puts (tail risk protection)',
            'Roll positions at expiry (30-45 DTE sweet spot)',
            'Reduce exposure when VIX > 30 (elevated risk)',
        ],
        assets: ['Options', 'VIX Futures'],
        timeframe: '30-45 DTE',
        backtest_note: 'Steady income 70-80% of the time, but requires strict risk management for tail events.',
    },

    // === TREND FOLLOWING ===
    {
        id: 'turtle-breakout',
        name: 'Turtle Trading Breakout System',
        category: 'Trend Following',
        difficulty: 'Beginner',
        source: 'Richard Dennis & William Eckhardt (1983) — "The Original Turtle Trading Rules"',
        description: 'The famous Turtle experiment: buy on 20-day highs, sell on 10-day lows. Uses ATR-based position sizing for risk management. Proven across commodities and futures.',
        rules: [
            'BUY when price breaks above the 20-day high (System 1)',
            'SELL when price breaks below the 10-day low',
            'Position size = 1% account risk / (ATR × dollar per point)',
            'Max 4 units per market, 10 units per direction',
            'Add to winners every 0.5 ATR up to max units',
        ],
        assets: ['Futures', 'Forex', 'Commodities'],
        timeframe: '1D',
        backtest_note: '35-40% win rate but 3-5 R:R. Profits come from big trends; many small losses in ranging markets.',
    },
    {
        id: 'trend-following-managed-futures',
        name: 'Managed Futures Trend-Following',
        category: 'Trend Following',
        difficulty: 'Advanced',
        source: 'Hurst, Ooi & Pedersen (2017) — AQR / "A Century of Evidence on Trend-Following Investing"',
        description: 'Systematic trend-following across dozens of futures markets (equities, bonds, commodities, FX). Uses lookback periods of 1-12 months and volatility-adjusted sizing. The backbone of CTAs like Man AHL, Winton, AQR.',
        rules: [
            'Calculate EWMA of returns over 1, 3, and 12 month windows',
            'Signal = sign of blended trend signal',
            'Position = signal × target_vol / asset_vol',
            'Diversify across 50+ liquid futures markets',
            'Rebalance daily or weekly',
        ],
        assets: ['Futures'],
        timeframe: 'Daily/Weekly',
        backtest_note: 'Crisis alpha: strong positive returns during equity drawdowns. Sharpe ~0.7-1.0 over 100 years.',
    },

    // === MACHINE LEARNING ===
    {
        id: 'ml-alpha-factors',
        name: 'ML-Driven Alpha Factor Combination',
        category: 'Machine Learning',
        difficulty: 'Expert',
        source: 'López de Prado (2018) — "Advances in Financial Machine Learning"',
        description: 'Use machine learning to combine alpha signals (momentum, value, sentiment, technical) into a meta-model. Techniques include random forests, gradient boosting, and neural nets with proper cross-validation to avoid overfitting.',
        rules: [
            'Engineer features: momentum (various lookbacks), value ratios, volatility, volume, sentiment scores',
            'Use purged k-fold cross-validation (no lookahead bias)',
            'Train ensemble model (XGBoost or LGBM) to predict next-day returns',
            'Apply bet-sizing based on model confidence and Kelly criterion',
            'Walk-forward optimization with expanding or rolling windows',
        ],
        assets: ['Stocks', 'Futures', 'Crypto'],
        timeframe: '1D',
        backtest_note: 'Highly dependent on feature engineering and regime. Beware of overfitting — use combinatorial purged CV.',
    },

    // === CARRY ===
    {
        id: 'carry-trade',
        name: 'Carry Trade',
        category: 'Carry',
        difficulty: 'Intermediate',
        source: 'Koijen, Moskowitz, Pedersen & Vrugt (2018) — AQR / "Carry" / Journal of Financial Economics',
        description: 'Go long assets with high carry (yield, roll yield, or dividend) and short assets with low carry. Applied across asset classes: FX interest rate differentials, commodity futures roll yield, and equity dividend yields.',
        rules: [
            'Rank assets by carry signal (e.g., interest rate differential for FX)',
            'LONG top 20% by carry, SHORT bottom 20%',
            'Volatility-target each position to equalize risk contribution',
            'Diversify across asset classes for lower drawdowns',
            'Rebalance monthly',
        ],
        assets: ['Forex', 'Futures', 'Bonds'],
        timeframe: 'Monthly',
        backtest_note: 'Sharpe ~0.7-0.9. Underperforms in sudden risk-off events (carry crash). Combine with momentum for stability.',
    },

    // === EVENT DRIVEN ===
    {
        id: 'earnings-drift',
        name: 'Post-Earnings Announcement Drift (PEAD)',
        category: 'Event-Driven',
        difficulty: 'Intermediate',
        source: 'Bernard & Thomas (1989) — "Post-Earnings Announcement Drift" / Journal of Accounting Research',
        description: 'Stocks that beat earnings estimates tend to continue drifting up for 60 days after the announcement, and vice versa. One of the most robust anomalies in finance — still traded by quant funds.',
        rules: [
            'Identify stocks with positive Standardized Unexpected Earnings (SUE > 0)',
            'BUY within 1 day of earnings beat, hold for 60 trading days',
            'SHORT stocks with SUE < 0 (significant miss)',
            'Size based on magnitude of SUE score',
            'Exit at the 60-day mark or next earnings date',
        ],
        assets: ['Stocks'],
        timeframe: '1D (hold ~60D)',
        backtest_note: 'Consistent 2-4% return over 60 days for top SUE quintile. Reduced but still present after decades.',
    },

    // === HIGH FREQUENCY ===
    {
        id: 'hft-momentum',
        name: 'HFT Momentum & Microstructure',
        category: 'High Frequency',
        difficulty: 'Expert',
        source: 'Aldridge (2013) — "High-Frequency Trading: A Practical Guide" / Cartea, Jaimungal & Penalva (2015)',
        description: 'High-frequency strategy exploiting VWAP deviations, tick-level momentum, and volume surges. Identifies micro-price dislocations and trades the reversion or continuation with sub-second to minute-level holding periods.',
        rules: [
            'Calculate rolling VWAP over 30 periods',
            'BUY when price is >0.15% below VWAP with positive tick momentum and volume surge >1.3x',
            'SELL when price is >0.15% above VWAP with negative tick momentum and volume surge >1.3x',
            'Use micro-price (weighted mid-price) for precise entry timing',
            'Position size: small, high frequency — max 0.5% risk per trade',
        ],
        assets: ['Crypto', 'Futures', 'Forex'],
        timeframe: '1m / Tick',
        backtest_note: 'High win rate (60-70%) with tiny gains per trade. Requires low latency and tight spreads. Volume-dependent.',
    },

    // === STATISTICAL / QUANT ===
    {
        id: 'jim-simons-linreg',
        name: 'Jim Simons Linear Regression',
        category: 'Machine Learning',
        difficulty: 'Expert',
        source: 'Inspired by Renaissance Technologies — Simons, Berlekamp, Ax (1988–present)',
        description: 'Rolling linear regression on price series to identify trend direction and mean-reversion opportunities. Uses short-term (20-bar) and long-term (50-bar) regression slopes with R² confidence filtering. Based on the quantitative approach pioneered by Jim Simons at Renaissance Technologies.',
        rules: [
            'Calculate short-term (20-bar) and long-term (50-bar) linear regression slopes',
            'BUY when both slopes are positive and R² > 0.6 (strong trend confirmation)',
            'SELL when both slopes are negative and R² > 0.6',
            'Mean Reversion: BUY short-term dips in long-term uptrend, SELL rallies in downtrend',
            'Size positions proportional to R² confidence and slope magnitude',
        ],
        assets: ['Stocks', 'Futures', 'Crypto', 'Forex'],
        timeframe: '1D / 1m (adaptive)',
        backtest_note: 'Combines trend-following and mean-reversion. Historical Sharpe ~1.0-1.5 in trending regimes. R² filter reduces false signals significantly.',
    },
];

module.exports = QUANT_STRATEGIES;
