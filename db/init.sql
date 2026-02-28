-- TradeVault Database Schema
-- MySQL 8.0

CREATE DATABASE IF NOT EXISTS tradevault
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE tradevault;

-- 1. Users
CREATE TABLE IF NOT EXISTS users (
  user_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  risk_profile VARCHAR(50) DEFAULT 'moderate',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Migration: add password_hash if table already exists without it
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) NOT NULL DEFAULT '' AFTER email;
CREATE TABLE IF NOT EXISTS strategies (
  strategy_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  strategy_name VARCHAR(100) NOT NULL,
  timeframe VARCHAR(30),
  description TEXT,
  risk_per_trade DECIMAL(5,2) DEFAULT 1.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 3. Trades
CREATE TABLE IF NOT EXISTS trades (
  trade_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  strategy_id INT,
  symbol VARCHAR(20) NOT NULL,
  asset_class VARCHAR(30) DEFAULT 'stock',
  entry_price DECIMAL(18,6) NOT NULL,
  exit_price DECIMAL(18,6),
  position_size DECIMAL(18,6) NOT NULL,
  stop_loss DECIMAL(18,6),
  take_profit DECIMAL(18,6),
  direction ENUM('BUY','SELL') NOT NULL DEFAULT 'BUY',
  result ENUM('WIN','LOSS','BE') DEFAULT NULL,
  pnl DECIMAL(18,2) DEFAULT 0,
  rr_ratio DECIMAL(6,2),
  confidence_rating TINYINT CHECK (confidence_rating BETWEEN 1 AND 5),
  trade_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (strategy_id) REFERENCES strategies(strategy_id) ON DELETE SET NULL
);

-- 4. Trade Execution Log
CREATE TABLE IF NOT EXISTS trade_execution_log (
  execution_id INT AUTO_INCREMENT PRIMARY KEY,
  trade_id INT NOT NULL,
  execution_time DATETIME NOT NULL,
  execution_price DECIMAL(18,6) NOT NULL,
  quantity DECIMAL(18,6) NOT NULL,
  FOREIGN KEY (trade_id) REFERENCES trades(trade_id) ON DELETE CASCADE
);

-- 5. Market Conditions
CREATE TABLE IF NOT EXISTS market_conditions (
  condition_id INT AUTO_INCREMENT PRIMARY KEY,
  trade_id INT NOT NULL UNIQUE,
  trend ENUM('bullish','bearish','range') DEFAULT 'range',
  volatility_index DECIMAL(8,2),
  news_event BOOLEAN DEFAULT FALSE,
  session ENUM('London','NY','Asia','Other') DEFAULT 'Other',
  FOREIGN KEY (trade_id) REFERENCES trades(trade_id) ON DELETE CASCADE
);

-- 6. Screenshots
CREATE TABLE IF NOT EXISTS screenshots (
  screenshot_id INT AUTO_INCREMENT PRIMARY KEY,
  trade_id INT NOT NULL,
  image_path VARCHAR(500) NOT NULL,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trade_id) REFERENCES trades(trade_id) ON DELETE CASCADE
);

-- Note: Users are now created via the signup page.
-- To migrate an existing DB, run:
-- ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NOT NULL DEFAULT '' AFTER email;
