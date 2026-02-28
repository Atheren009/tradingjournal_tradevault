"""
TradeVault — DQN RL Trading Model with GPU Training
=====================================================
Trains a Deep Q-Network on historical market data.
Includes HFT Momentum and Jim Simons Linear Regression strategies.
Outputs backtest results as JSON for the Node.js server.
"""

import os
import json
import random
import numpy as np
import pandas as pd
from datetime import datetime
from collections import deque

import torch
import torch.nn as nn
import torch.optim as optim

# =========== CONFIG ===========
TICKER = "SPY"
PERIOD = "5y"
INITIAL_CAPITAL = 100_000
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")
os.makedirs(RESULTS_DIR, exist_ok=True)

print(f"\n🧠 TradeVault RL Model — Training on {DEVICE.type.upper()}")
print(f"   Ticker: {TICKER} | Period: {PERIOD} | Capital: ${INITIAL_CAPITAL:,}\n")


# =========== DATA ===========
def fetch_data():
    import yfinance as yf
    print("📥 Fetching historical data...")
    df = yf.download(TICKER, period=PERIOD, interval="1d", progress=False)
    # Flatten MultiIndex columns if present
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [col[0] for col in df.columns]
    df.dropna(inplace=True)
    print(f"   Got {len(df)} trading days")
    return df


def engineer_features(df):
    """Create technical indicator features."""
    d = df.copy()
    c = d['Close']

    # Moving Averages
    d['SMA_10'] = c.rolling(10).mean()
    d['SMA_30'] = c.rolling(30).mean()
    d['SMA_50'] = c.rolling(50).mean()

    # RSI
    delta = c.diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = (-delta.clip(upper=0)).rolling(14).mean()
    rs = gain / (loss + 1e-10)
    d['RSI'] = 100 - (100 / (1 + rs))

    # MACD
    ema12 = c.ewm(span=12).mean()
    ema26 = c.ewm(span=26).mean()
    d['MACD'] = ema12 - ema26
    d['MACD_signal'] = d['MACD'].ewm(span=9).mean()

    # Bollinger Bands
    bb_sma = c.rolling(20).mean()
    bb_std = c.rolling(20).std()
    d['BB_upper'] = bb_sma + 2 * bb_std
    d['BB_lower'] = bb_sma - 2 * bb_std
    d['BB_pct'] = (c - d['BB_lower']) / (d['BB_upper'] - d['BB_lower'] + 1e-10)

    # ATR
    high_low = d['High'] - d['Low']
    high_close = (d['High'] - c.shift()).abs()
    low_close = (d['Low'] - c.shift()).abs()
    tr = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
    d['ATR'] = tr.rolling(14).mean()

    # Volume ratio
    d['Vol_ratio'] = d['Volume'] / d['Volume'].rolling(20).mean()

    # Price momentum
    d['Return_1d'] = c.pct_change()
    d['Return_5d'] = c.pct_change(5)
    d['Return_10d'] = c.pct_change(10)

    # Linear regression slope (Jim Simons feature)
    def rolling_slope(series, window):
        slopes = []
        for i in range(len(series)):
            if i < window - 1:
                slopes.append(0)
            else:
                y = series.iloc[i - window + 1:i + 1].values
                x = np.arange(window)
                slope = np.polyfit(x, y, 1)[0]
                slopes.append(slope)
        return pd.Series(slopes, index=series.index)

    d['LR_slope_20'] = rolling_slope(c, 20)
    d['LR_slope_50'] = rolling_slope(c, 50)

    d.dropna(inplace=True)
    return d


FEATURE_COLS = [
    'SMA_10', 'SMA_30', 'SMA_50', 'RSI', 'MACD', 'MACD_signal',
    'BB_pct', 'ATR', 'Vol_ratio', 'Return_1d', 'Return_5d', 'Return_10d',
    'LR_slope_20', 'LR_slope_50'
]


def normalize_features(df):
    """Min-max normalize features."""
    features = df[FEATURE_COLS].copy()
    for col in features.columns:
        mn, mx = features[col].min(), features[col].max()
        rng = mx - mn if mx - mn > 0 else 1
        features[col] = (features[col] - mn) / rng
    return features.values


# =========== DQN MODEL ===========
class DQN(nn.Module):
    def __init__(self, input_dim, output_dim=3):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, 128),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Linear(32, output_dim)
        )

    def forward(self, x):
        return self.net(x)


class ReplayBuffer:
    def __init__(self, capacity=10000):
        self.buffer = deque(maxlen=capacity)

    def push(self, state, action, reward, next_state, done):
        self.buffer.append((state, action, reward, next_state, done))

    def sample(self, batch_size):
        batch = random.sample(self.buffer, batch_size)
        states, actions, rewards, next_states, dones = zip(*batch)
        return (
            np.array(states), np.array(actions), np.array(rewards),
            np.array(next_states), np.array(dones)
        )

    def __len__(self):
        return len(self.buffer)


# =========== TRADING ENVIRONMENT ===========
class TradingEnv:
    ACTIONS = ['HOLD', 'BUY', 'SELL']

    def __init__(self, features, prices, initial_capital=100000):
        self.features = features
        self.prices = prices
        self.initial_capital = initial_capital
        self.reset()

    def reset(self):
        self.step_idx = 0
        self.capital = self.initial_capital
        self.position = 0  # shares held
        self.portfolio_values = [self.initial_capital]
        self.trades = []
        return self.features[0]

    def step(self, action):
        price = self.prices[self.step_idx]
        next_price = self.prices[min(self.step_idx + 1, len(self.prices) - 1)]

        # Execute action
        if action == 1 and self.position == 0:  # BUY
            shares = int(self.capital * 0.95 / price)
            if shares > 0:
                self.position = shares
                self.capital -= shares * price
                self.trades.append(('BUY', self.step_idx, price))

        elif action == 2 and self.position > 0:  # SELL
            self.capital += self.position * price
            self.trades.append(('SELL', self.step_idx, price))
            self.position = 0

        # Calculate portfolio value
        portfolio_value = self.capital + self.position * price
        prev_value = self.portfolio_values[-1]
        self.portfolio_values.append(portfolio_value)

        # Reward = normalized P&L change
        reward = (portfolio_value - prev_value) / prev_value * 100

        self.step_idx += 1
        done = self.step_idx >= len(self.features) - 1

        next_state = self.features[min(self.step_idx, len(self.features) - 1)]
        return next_state, reward, done


# =========== DQN AGENT ===========
class DQNAgent:
    def __init__(self, state_dim, action_dim=3, lr=1e-3, gamma=0.99, tau=0.005):
        self.policy_net = DQN(state_dim, action_dim).to(DEVICE)
        self.target_net = DQN(state_dim, action_dim).to(DEVICE)
        self.target_net.load_state_dict(self.policy_net.state_dict())
        self.optimizer = optim.Adam(self.policy_net.parameters(), lr=lr)
        self.buffer = ReplayBuffer()
        self.gamma = gamma
        self.tau = tau
        self.epsilon = 1.0
        self.epsilon_min = 0.01
        self.epsilon_decay = 0.995
        self.batch_size = 64

    def select_action(self, state, training=True):
        if training and random.random() < self.epsilon:
            return random.randint(0, 2)
        with torch.no_grad():
            state_t = torch.FloatTensor(state).unsqueeze(0).to(DEVICE)
            q_values = self.policy_net(state_t)
            return q_values.argmax(dim=1).item()

    def train_step(self):
        if len(self.buffer) < self.batch_size:
            return 0.0

        states, actions, rewards, next_states, dones = self.buffer.sample(self.batch_size)

        states_t = torch.FloatTensor(states).to(DEVICE)
        actions_t = torch.LongTensor(actions).to(DEVICE)
        rewards_t = torch.FloatTensor(rewards).to(DEVICE)
        next_states_t = torch.FloatTensor(next_states).to(DEVICE)
        dones_t = torch.FloatTensor(dones).to(DEVICE)

        # Current Q values
        current_q = self.policy_net(states_t).gather(1, actions_t.unsqueeze(1)).squeeze()

        # Target Q values
        with torch.no_grad():
            next_q = self.target_net(next_states_t).max(1)[0]
            target_q = rewards_t + self.gamma * next_q * (1 - dones_t)

        loss = nn.MSELoss()(current_q, target_q)
        self.optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(self.policy_net.parameters(), 1.0)
        self.optimizer.step()

        # Soft update target network
        for target_param, policy_param in zip(self.target_net.parameters(), self.policy_net.parameters()):
            target_param.data.copy_(self.tau * policy_param.data + (1 - self.tau) * target_param.data)

        # Decay epsilon
        self.epsilon = max(self.epsilon_min, self.epsilon * self.epsilon_decay)

        return loss.item()


# =========== BACKTESTING ===========
def backtest_dqn(agent, features, prices, dates):
    """Run trained DQN agent through historical data."""
    env = TradingEnv(features, prices, INITIAL_CAPITAL)
    state = env.reset()
    while True:
        action = agent.select_action(state, training=False)
        state, _, done = env.step(action)
        if done:
            break
    return env.portfolio_values, env.trades


def backtest_hft(prices, volumes, dates):
    """HFT Momentum backtest — VWAP deviation strategy."""
    capital = INITIAL_CAPITAL
    position = 0
    portfolio = [capital]
    trades = []

    for i in range(30, len(prices)):
        # Calculate VWAP
        recent_prices = prices[i-30:i]
        recent_volumes = volumes[i-30:i]
        vwap = np.sum(recent_prices * recent_volumes) / (np.sum(recent_volumes) + 1e-10)

        vwap_dev = (prices[i] - vwap) / vwap * 100
        avg_vol = np.mean(volumes[i-30:i-1])
        vol_ratio = volumes[i] / (avg_vol + 1e-10)

        # Tick momentum
        tick_mom = np.sum(np.diff(prices[i-10:i+1]))

        if vwap_dev < -0.2 and tick_mom > 0 and vol_ratio > 1.2 and position == 0:
            shares = int(capital * 0.95 / prices[i])
            if shares > 0:
                position = shares
                capital -= shares * prices[i]
                trades.append(('BUY', i, prices[i]))
        elif (vwap_dev > 0.2 or tick_mom < 0) and position > 0:
            capital += position * prices[i]
            trades.append(('SELL', i, prices[i]))
            position = 0

        portfolio.append(capital + position * prices[i])

    # Pad beginning
    portfolio = [INITIAL_CAPITAL] * 30 + portfolio
    return portfolio[:len(prices)+1], trades


def backtest_linreg(prices, dates):
    """Jim Simons Linear Regression backtest."""
    capital = INITIAL_CAPITAL
    position = 0
    portfolio = [capital]
    trades = []

    for i in range(50, len(prices)):
        closes = prices[i-50:i+1]

        # Short regression (20)
        y_short = closes[-20:]
        x_short = np.arange(20)
        short_slope = np.polyfit(x_short, y_short, 1)[0]

        # Long regression (50)
        y_long = closes
        x_long = np.arange(51)
        long_slope = np.polyfit(x_long, y_long, 1)[0]

        avg_price = np.mean(closes)
        short_norm = (short_slope / avg_price) * 100
        long_norm = (long_slope / avg_price) * 100

        if short_norm > 0.05 and long_norm > 0 and position == 0:
            shares = int(capital * 0.95 / prices[i])
            if shares > 0:
                position = shares
                capital -= shares * prices[i]
                trades.append(('BUY', i, prices[i]))
        elif (short_norm < -0.05 and long_norm < 0) and position > 0:
            capital += position * prices[i]
            trades.append(('SELL', i, prices[i]))
            position = 0
        elif short_norm < -0.1 and long_norm > 0.02 and position == 0:
            shares = int(capital * 0.95 / prices[i])
            if shares > 0:
                position = shares
                capital -= shares * prices[i]
                trades.append(('BUY', i, prices[i]))

        portfolio.append(capital + position * prices[i])

    portfolio = [INITIAL_CAPITAL] * 50 + portfolio
    return portfolio[:len(prices)+1], trades


def compute_metrics(portfolio_values, trades, prices):
    """Compute performance metrics."""
    pv = np.array(portfolio_values, dtype=float)
    returns = np.diff(pv) / pv[:-1]
    returns = returns[np.isfinite(returns)]

    total_return = (pv[-1] / pv[0] - 1) * 100

    # Win rate from trades
    wins = 0
    total_trades = 0
    i = 0
    while i < len(trades) - 1:
        if trades[i][0] == 'BUY' and trades[i+1][0] == 'SELL':
            if trades[i+1][2] > trades[i][2]:
                wins += 1
            total_trades += 1
            i += 2
        else:
            i += 1

    win_rate = (wins / total_trades * 100) if total_trades > 0 else 0

    # Sharpe ratio (annualized)
    if len(returns) > 0 and np.std(returns) > 0:
        sharpe = np.mean(returns) / np.std(returns) * np.sqrt(252)
    else:
        sharpe = 0

    # Max drawdown
    peak = np.maximum.accumulate(pv)
    drawdown = (pv - peak) / peak * 100
    max_dd = drawdown.min()

    # Profit factor
    gains = returns[returns > 0].sum()
    losses = abs(returns[returns < 0].sum())
    profit_factor = gains / losses if losses > 0 else float('inf')

    return {
        'total_return': round(total_return, 2),
        'win_rate': round(win_rate, 1),
        'sharpe_ratio': round(sharpe, 2),
        'max_drawdown': round(max_dd, 1),
        'total_trades': total_trades,
        'profit_factor': round(min(profit_factor, 99.99), 2),
    }


def compute_yearly(portfolio_values, trades, dates, strategy_name):
    """Compute year-by-year metrics."""
    pv = np.array(portfolio_values[:len(dates)], dtype=float)
    yearly = []

    if len(dates) == 0:
        return yearly

    years = sorted(set(d.year for d in dates))

    for year in years:
        mask = np.array([d.year == year for d in dates])
        if mask.sum() < 5:
            continue

        year_pv = pv[mask]
        year_returns = np.diff(year_pv) / year_pv[:-1]
        year_returns = year_returns[np.isfinite(year_returns)]

        ret = (year_pv[-1] / year_pv[0] - 1) * 100

        # Count trades in this year
        year_trades = [t for t in trades if dates[min(t[1], len(dates)-1)].year == year]
        n_buys = sum(1 for t in year_trades if t[0] == 'BUY')
        # Win count
        wins = 0
        total = 0
        i = 0
        while i < len(year_trades) - 1:
            if year_trades[i][0] == 'BUY' and year_trades[i+1][0] == 'SELL':
                if year_trades[i+1][2] > year_trades[i][2]:
                    wins += 1
                total += 1
                i += 2
            else:
                i += 1

        wr = (wins / total * 100) if total > 0 else 0

        sharpe = 0
        if len(year_returns) > 0 and np.std(year_returns) > 0:
            sharpe = np.mean(year_returns) / np.std(year_returns) * np.sqrt(252)

        peak = np.maximum.accumulate(year_pv)
        dd = ((year_pv - peak) / peak * 100).min()

        gains = year_returns[year_returns > 0].sum()
        losses_val = abs(year_returns[year_returns < 0].sum())
        pf = gains / losses_val if losses_val > 0 else 99.99

        yearly.append({
            'year': year,
            'strategy': strategy_name,
            'return_pct': round(ret, 1),
            'trades': total,
            'win_rate': round(wr, 1),
            'sharpe': round(sharpe, 2),
            'max_dd': round(dd, 1),
            'profit_factor': round(min(pf, 99.99), 2),
        })

    return yearly


# =========== MAIN ===========
def main():
    # Fetch data
    df = fetch_data()
    df = engineer_features(df)

    features = normalize_features(df)
    prices = df['Close'].values
    volumes = df['Volume'].values
    dates = [d.to_pydatetime() if hasattr(d, 'to_pydatetime') else d for d in df.index]

    state_dim = features.shape[1]

    # ======= TRAIN DQN =======
    print(f"\n🚀 Training DQN Agent on {DEVICE.type.upper()} ({len(features)} steps)...")
    agent = DQNAgent(state_dim)
    env = TradingEnv(features, prices, INITIAL_CAPITAL)

    EPISODES = 50
    for ep in range(EPISODES):
        state = env.reset()
        total_reward = 0
        total_loss = 0
        steps = 0

        while True:
            action = agent.select_action(state, training=True)
            next_state, reward, done = env.step(action)
            agent.buffer.push(state, action, reward, next_state, float(done))

            loss = agent.train_step()
            total_reward += reward
            total_loss += loss
            steps += 1
            state = next_state

            if done:
                break

        if (ep + 1) % 10 == 0:
            final_val = env.portfolio_values[-1]
            ret = (final_val / INITIAL_CAPITAL - 1) * 100
            print(f"   Episode {ep+1}/{EPISODES} | Return: {ret:+.1f}% | "
                  f"Epsilon: {agent.epsilon:.3f} | Loss: {total_loss/steps:.4f}")

    # Save model
    model_path = os.path.join(RESULTS_DIR, "dqn_model.pth")
    torch.save(agent.policy_net.state_dict(), model_path)
    print(f"\n💾 Model saved to {model_path}")

    # ======= BACKTEST ALL STRATEGIES =======
    print("\n📊 Running backtests...")

    # DQN backtest
    dqn_portfolio, dqn_trades = backtest_dqn(agent, features, prices, dates)
    dqn_metrics = compute_metrics(dqn_portfolio, dqn_trades, prices)
    dqn_yearly = compute_yearly(dqn_portfolio, dqn_trades, dates, "DQN Agent")
    print(f"   DQN: {dqn_metrics['total_return']:+.1f}% return, "
          f"{dqn_metrics['win_rate']:.0f}% win rate, Sharpe {dqn_metrics['sharpe_ratio']:.2f}")

    # HFT backtest
    hft_portfolio, hft_trades = backtest_hft(prices, volumes, dates)
    hft_metrics = compute_metrics(hft_portfolio, hft_trades, prices)
    hft_yearly = compute_yearly(hft_portfolio, hft_trades, dates, "HFT Momentum")
    print(f"   HFT: {hft_metrics['total_return']:+.1f}% return, "
          f"{hft_metrics['win_rate']:.0f}% win rate, Sharpe {hft_metrics['sharpe_ratio']:.2f}")

    # Linear Regression backtest
    lr_portfolio, lr_trades = backtest_linreg(prices, dates)
    lr_metrics = compute_metrics(lr_portfolio, lr_trades, prices)
    lr_yearly = compute_yearly(lr_portfolio, lr_trades, dates, "Jim Simons LR")
    print(f"   LR:  {lr_metrics['total_return']:+.1f}% return, "
          f"{lr_metrics['win_rate']:.0f}% win rate, Sharpe {lr_metrics['sharpe_ratio']:.2f}")

    # ======= BUILD RESULTS JSON =======
    def to_equity_curve(portfolio, dates_list):
        # Sample every N days to keep JSON manageable
        step = max(1, len(dates_list) // 500)
        sampled_dates = [dates_list[i].strftime('%Y-%m-%d') for i in range(0, len(dates_list), step)]
        sampled_values = [
            round((portfolio[min(i, len(portfolio)-1)] / INITIAL_CAPITAL - 1) * 100, 2)
            for i in range(0, len(dates_list), step)
        ]
        return {'dates': sampled_dates, 'values': sampled_values}

    results = {
        'summary': dqn_metrics,
        'training': {
            'device': DEVICE.type.upper(),
            'episodes': EPISODES,
            'ticker': TICKER,
            'period': PERIOD,
            'features': FEATURE_COLS,
            'trained_at': datetime.now().isoformat(),
        },
        'yearly': dqn_yearly + hft_yearly + lr_yearly,
        'equity_curves': {
            'dqn': to_equity_curve(dqn_portfolio, dates),
            'hft': to_equity_curve(hft_portfolio, dates),
            'linreg': to_equity_curve(lr_portfolio, dates),
        },
        'strategy_metrics': {
            'dqn': dqn_metrics,
            'hft': hft_metrics,
            'linreg': lr_metrics,
        },
    }

    output_path = os.path.join(RESULTS_DIR, "backtest.json")
    with open(output_path, 'w') as f:
        json.dump(results, f, indent=2)

    print(f"\n✅ Results saved to {output_path}")
    print(f"   Start the Node server and visit the RL Model tab to view results.\n")


if __name__ == '__main__':
    main()
