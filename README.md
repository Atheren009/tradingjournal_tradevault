# TradeVault - Algo Trading Journal & RL Model

TradeVault is a complete trading journaling application with built-in real-time market signals, quantitative strategies, and a reinforcement learning (Deep Q-Network) model for trade suggestions. The platform features an Express/Node.js backend, a responsive Vanilla JS frontend, and a Python-based RL training engine.

## Features

- **Trading Journal**: Log, view, edit, and delete trades (stocks, crypto, etc.).
- **Live Signals Engine**: Real-time market data via WebSocket, running strategies like SMA Crossover, RSI Reversal, and Breakout to suggest live trades.
- **Custom Strategies**: Define and manage algorithmic or manual trading strategies.
- **Reinforcement Learning Model**: Python-based DQN model that trains on historical crypto data to provide market suggestions and backtest strategies against HFT momentum and Linear Regression baselines.
- **Analytics Dashboard**: Automatic PnL calculation, win rate, average risk-reward, and detailed trade execution logs.
- **Authentication**: Secure user signup, login, and session handling using JWT and bcrypt.
- **Screenshots & Data**: Upload chart screenshots using Multer to attach visual proof to your trade entries.

## Tech Stack

- **Frontend**: HTML5, Vanilla JavaScript, CSS3
- **Backend API**: Node.js, Express.js
- **Database**: MySQL
- **Real-Time Data**: WebSocket (`ws`), Binance Live Data
- **Machine Learning**: Python 3.10+, PyTorch, Scikit-learn, Pandas, yfinance

## Prerequisites

- **Node.js** v18+ and `npm`
- **Python** 3.10+ and `pip`
- **MySQL** installed and running on default port `3306`

## Setup & Run Instructions

### 1. Database Setup

1. Open your MySQL client or terminal.
2. Initialize the database schema and tables:
   ```bash
   mysql -u root -p < db/init.sql
   ```
   *(Ensure the connection details match those in `db/connection.js`: Host `localhost`, User `root`, Password `root`)*

### 2. Backend & Frontend Setup

1. Navigate to the project root directory:
   ```bash
   cd path/to/TradeVault
   ```
2. Install Node.js dependencies:
   ```bash
   npm install
   ```
3. Start the application (Backend API & WebSocket Signal Engine):
   ```bash
   node server.js
   ```
   *(The server will start at `http://localhost:3000`)*

4. Open your web browser and navigate to `http://localhost:3000/login` to get started.

### 3. Reinforcement Learning Setup (Optional)

If you want to run the provided RL Model to get trade suggestions and perform historical backtesting:

1. Create and activate a Python virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate       # On Mac/Linux
   venv\Scripts\activate          # On Windows
   ```
2. Install Python dependencies:
   ```bash
   pip install -r rl_model/requirements.txt
   ```
3. Train the DQN Model and perform Backtesting:
   ```bash
   python rl_model/train.py
   ```
   *(This script will download historical crypto data, train the agent, backtest strategies, and create `results/backtest.json` which the Node JS backend consumes).*

## Usage

1. **Sign Up / Login**: Access `http://localhost:3000/login` to create an account.
2. **Dashboard**: Get a bird's eye view of your metrics (PnL, Win Rate) and recent activity.
3. **Journal trades**: Add new trades directly from the dashboard, upload screenshots, specify exit prices, and assign quantitative strategies.
4. **Live Signals**: Switch to the quantitative signal interface to view live ticker recommendations generated over WebSocket.
5. **RL Suggestions**: The dashboard uses RL backend suggestions to guide market entry under prevailing volatility and trend scenarios.
