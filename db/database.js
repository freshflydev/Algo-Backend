import { DatabaseSync } from 'node:sqlite';
import path from 'path';

const DB_PATH = path.resolve('algotrade.sqlite');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mobile TEXT NOT NULL UNIQUE,
      name TEXT,
      target_level INTEGER NOT NULL DEFAULT 1 CHECK(target_level BETWEEN 1 AND 5),
      max_concurrent_orders INTEGER NOT NULL DEFAULT 2,
      is_active INTEGER NOT NULL DEFAULT 1,
      intraday_wallet REAL NOT NULL DEFAULT 100000,
      swing_wallet REAL NOT NULL DEFAULT 100000,
      total_realized_pnl REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_strategy_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      intraday_enabled INTEGER NOT NULL DEFAULT 1,
      intraday_scope TEXT NOT NULL DEFAULT 'WATCHLIST' CHECK(intraday_scope IN ('WATCHLIST', 'AUTOMATED')),
      intraday_direction TEXT NOT NULL DEFAULT 'BOTH' CHECK(intraday_direction IN ('BUY', 'SELL', 'BOTH')),
      intraday_trade_amount REAL NOT NULL DEFAULT 50000,
      intraday_leverage INTEGER NOT NULL DEFAULT 5,
      intraday_fresh_trend_only INTEGER NOT NULL DEFAULT 0,
      swing_enabled INTEGER NOT NULL DEFAULT 0,
      swing_scope TEXT NOT NULL DEFAULT 'WATCHLIST' CHECK(swing_scope IN ('WATCHLIST', 'AUTOMATED')),
      swing_trade_amount REAL NOT NULL DEFAULT 50000,
      swing_leverage INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_watchlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      watchlist_name TEXT NOT NULL DEFAULT 'default',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, symbol, watchlist_name)
    );

    CREATE TABLE IF NOT EXISTS user_brokers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      broker TEXT NOT NULL CHECK(broker IN ('fyers', 'upstox')),
      label TEXT,
      api_key TEXT NOT NULL,
      secret_key TEXT NOT NULL,
      redirect_url TEXT,
      access_token TEXT,
      refresh_token TEXT,
      auth_code TEXT,
      token_expires_at TEXT,
      connected_at TEXT,
      is_connected INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin_brokers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      broker TEXT NOT NULL UNIQUE CHECK(broker IN ('fyers')),
      api_key TEXT NOT NULL,
      secret_key TEXT NOT NULL,
      redirect_url TEXT,
      access_token TEXT,
      refresh_token TEXT,
      auth_code TEXT,
      token_expires_at TEXT,
      connected_at TEXT,
      is_connected INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS instruments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL UNIQUE,
      segment TEXT NOT NULL DEFAULT 'NSE',
      instrument_type TEXT NOT NULL DEFAULT '-EQ',
      category TEXT NOT NULL CHECK(category IN ('stock', 'index', 'commodity')),
      enabled INTEGER NOT NULL DEFAULT 1,
      last_sync_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'idle',
      sync_progress INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS login_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      mobile TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
      status TEXT NOT NULL DEFAULT 'success',
      message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS strategy_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('intraday', 'swing')),
      direction TEXT NOT NULL DEFAULT 'BOTH' CHECK(direction IN ('BUY', 'SELL', 'BOTH')),
      timeframe TEXT NOT NULL,
      min_capital REAL NOT NULL DEFAULT 50000,
      enabled INTEGER NOT NULL DEFAULT 1,
      settings_json TEXT NOT NULL DEFAULT '{}',
      description TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_strategy_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      strategy_code TEXT NOT NULL REFERENCES strategy_catalog(code) ON DELETE CASCADE,
      target_level INTEGER NOT NULL DEFAULT 1 CHECK(target_level BETWEEN 1 AND 5),
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, strategy_code)
    );

    CREATE TABLE IF NOT EXISTS candles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      resolution TEXT NOT NULL,
      candle_time INTEGER NOT NULL,
      trade_date TEXT NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'fyers',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(symbol, resolution, candle_time)
    );

    CREATE TABLE IF NOT EXISTS gann_levels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      trade_date TEXT NOT NULL,
      source_price REAL NOT NULL,
      source_kind TEXT NOT NULL,
      buy REAL NOT NULL,
      buy_sl REAL NOT NULL,
      buy_target1 REAL NOT NULL,
      buy_target2 REAL NOT NULL,
      buy_target3 REAL NOT NULL,
      buy_target4 REAL NOT NULL,
      buy_target5 REAL NOT NULL,
      sell REAL NOT NULL,
      sell_sl REAL NOT NULL,
      sell_target1 REAL NOT NULL,
      sell_target2 REAL NOT NULL,
      sell_target3 REAL NOT NULL,
      sell_target4 REAL NOT NULL,
      sell_target5 REAL NOT NULL,
      raw_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(symbol, trade_date)
    );

    CREATE TABLE IF NOT EXISTS daily_trend_analysis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      trade_date TEXT NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL DEFAULT 0,
      ha_open REAL NOT NULL,
      ha_high REAL NOT NULL,
      ha_low REAL NOT NULL,
      ha_close REAL NOT NULL,
      gann_buy REAL NOT NULL,
      gann_sell REAL NOT NULL,
      ha_gann_buy REAL NOT NULL,
      ha_gann_sell REAL NOT NULL,
      current_trend TEXT NOT NULL,
      atr_trend TEXT,
      consecutive_days INTEGER NOT NULL,
      stop_loss REAL,
      sl_hit INTEGER NOT NULL DEFAULT 0,
      day_change_value REAL,
      day_change_percent REAL,
      raw_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(symbol, trade_date)
    );

    CREATE TABLE IF NOT EXISTS algo_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('stopped', 'running')) DEFAULT 'stopped',
      started_at TEXT,
      stopped_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      broker TEXT NOT NULL,
      strategy TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('BUY', 'SELL')),
      product TEXT NOT NULL DEFAULT 'INTRADAY',
      quantity INTEGER NOT NULL,
      entry_price REAL NOT NULL,
      stop_loss REAL NOT NULL,
      target_price REAL NOT NULL,
      target_level INTEGER NOT NULL CHECK(target_level BETWEEN 1 AND 5),
      order_tag TEXT NOT NULL UNIQUE,
      broker_order_id TEXT,
      status TEXT NOT NULL DEFAULT 'created',
      exit_price REAL,
      exit_reason TEXT,
      entered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      exited_at TEXT,
      raw_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS order_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      message TEXT,
      price REAL,
      raw_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS backtests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy TEXT NOT NULL,
      symbol TEXT NOT NULL,
      range_from TEXT NOT NULL,
      range_to TEXT NOT NULL,
      stats_json TEXT NOT NULL,
      trades_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL CHECK(level IN ('debug', 'info', 'warn', 'error')),
      scope TEXT NOT NULL,
      message TEXT NOT NULL,
      raw_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS market_ticks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      ltp REAL NOT NULL,
      raw_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  applyLightweightMigrations();
  seedDefaults();
}

function applyLightweightMigrations() {
  const columns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
  const migrations = [
    ['intraday_wallet', 'ALTER TABLE users ADD COLUMN intraday_wallet REAL NOT NULL DEFAULT 100000'],
    ['swing_wallet', 'ALTER TABLE users ADD COLUMN swing_wallet REAL NOT NULL DEFAULT 100000'],
    ['total_realized_pnl', 'ALTER TABLE users ADD COLUMN total_realized_pnl REAL NOT NULL DEFAULT 0'],
  ];

  for (const [column, sql] of migrations) {
    if (!columns.includes(column)) db.exec(sql);
  }

  migrateUserBrokersForMultipleAccounts();
  addColumnIfMissing('user_brokers', 'label', 'ALTER TABLE user_brokers ADD COLUMN label TEXT');
  addColumnIfMissing('user_brokers', 'is_active', 'ALTER TABLE user_brokers ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('instruments', 'last_sync_at', 'ALTER TABLE instruments ADD COLUMN last_sync_at TEXT');
  addColumnIfMissing('instruments', 'sync_status', "ALTER TABLE instruments ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'idle'");
  addColumnIfMissing('instruments', 'sync_progress', 'ALTER TABLE instruments ADD COLUMN sync_progress INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('strategy_catalog', 'settings_json', "ALTER TABLE strategy_catalog ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}'");
}

function addColumnIfMissing(table, column, sql) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name);
  if (!columns.includes(column)) db.exec(sql);
}

function migrateUserBrokersForMultipleAccounts() {
  const indexes = db.prepare('PRAGMA index_list(user_brokers)').all();
  const hasUniqueBrokerIndex = indexes.some((item) => item.unique === 1);
  if (!hasUniqueBrokerIndex) return;

  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE IF NOT EXISTS user_brokers_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      broker TEXT NOT NULL CHECK(broker IN ('fyers', 'upstox')),
      label TEXT,
      api_key TEXT NOT NULL,
      secret_key TEXT NOT NULL,
      redirect_url TEXT,
      access_token TEXT,
      refresh_token TEXT,
      auth_code TEXT,
      token_expires_at TEXT,
      connected_at TEXT,
      is_connected INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO user_brokers_new(
      id, user_id, broker, label, api_key, secret_key, redirect_url, access_token,
      refresh_token, auth_code, token_expires_at, connected_at, is_connected,
      is_active, created_at, updated_at
    )
    SELECT
      id, user_id, broker, broker, api_key, secret_key, redirect_url, access_token,
      refresh_token, auth_code, token_expires_at, connected_at, is_connected,
      is_connected, created_at, updated_at
    FROM user_brokers;
    DROP TABLE user_brokers;
    ALTER TABLE user_brokers_new RENAME TO user_brokers;
    PRAGMA foreign_keys = ON;
  `);
}

function seedDefaults() {
  const defaults = [
    ['intraday_enabled', 'true'],
    ['swing_enabled', 'false'],
    ['intraday_ema_filter_enabled', 'false'],
    ['intraday_ha_doji_enabled', 'false'],
    ['intraday_ha_doji_ema_filter_enabled', 'true'],
    ['swing_ema_filter_enabled', 'true'],
    ['dry_run_orders', 'true'],
    ['risk_per_trade_fraction', '0.5'],
    ['fyers_rate_limit_per_second', '20'],
    ['fyers_rate_limit_safety_ms', '1100'],
    ['upstox_order_rate_limit_per_second', '10'],
    ['upstox_order_rate_limit_safety_ms', '1100'],
    ['max_daily_loss_per_user', '3000'],
    ['max_trades_per_user_per_day', '4'],
    ['max_sl_per_user_per_day', '2'],
    ['cooldown_after_sl_minutes', '30'],
    ['max_entry_risk_percent', '0.45'],
    ['spike_candle_percent', '1.2'],
    ['server_static_ip', ''],
  ];

  const stmt = db.prepare(`
    INSERT INTO app_settings(key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO NOTHING
  `);
  defaults.forEach(([key, value]) => stmt.run(key, value));

  const strategies = [
    ['intraday_gann_15m', 'GANN Breakout Intraday', 'intraday', 'BOTH', '15m', 50000, JSON.stringify({ emaFilter: false, targetLevels: [1, 2, 3, 4, 5] }), '15-minute GANN breakout strategy for intraday momentum.'],
    ['intraday_ha_doji_gann_15m', 'Heikin Ashi Doji Intraday', 'intraday', 'BOTH', '15m', 50000, JSON.stringify({ emaFilter: true, targetLevels: [2] }), '15-minute Heikin Ashi doji continuation strategy.'],
    ['swing_gann_daily', 'GANN Swing Continuation', 'swing', 'BUY', '1D', 100000, JSON.stringify({ emaFilter: true, targetLevels: [1, 2, 3, 4, 5] }), 'Daily GANN swing continuation strategy.'],
    ['swing_ha_doji_gann', 'Heikin Ashi Doji Swing', 'swing', 'BUY', '1D', 100000, JSON.stringify({ emaFilter: true, targetLevels: [2] }), 'Daily Heikin Ashi doji swing continuation strategy.'],
  ];
  const strategyStmt = db.prepare(`
    INSERT INTO strategy_catalog(code, name, mode, direction, timeframe, min_capital, settings_json, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name,
      mode = excluded.mode,
      direction = excluded.direction,
      timeframe = excluded.timeframe,
      min_capital = excluded.min_capital,
      settings_json = excluded.settings_json,
      description = excluded.description,
      updated_at = CURRENT_TIMESTAMP
  `);
  strategies.forEach((strategy) => strategyStmt.run(...strategy));
}

export function getDb() {
  return db;
}

export function nowIso() {
  return new Date().toISOString();
}
