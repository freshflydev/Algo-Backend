import 'dotenv/config';
import mysql from 'mysql2/promise';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);
const DB_PATH = path.resolve('algotrade.sqlite');
const hasMysqlConfig = Boolean(
  (process.env.MYSQL_DATABASE || process.env.DB_NAME) &&
  (process.env.MYSQL_USER || process.env.DB_USER),
);
const DB_CLIENT = (process.env.DB_CLIENT || process.env.DB_DRIVER || (hasMysqlConfig ? 'mysql' : 'sqlite')).toLowerCase();
const isMysql = DB_CLIENT === 'mysql';
const isProduction = process.env.NODE_ENV === 'production';
let db;

if (isProduction && !isMysql && process.env.ALLOW_SQLITE_IN_PRODUCTION !== 'true') {
  throw new Error('Refusing to start with SQLite in production. Set DB_CLIENT=mysql and MySQL credentials, or ALLOW_SQLITE_IN_PRODUCTION=true only for a temporary local test.');
}

function createMysqlDb() {
  return new MysqlCompatDb(mysql.createPool({
    host: process.env.MYSQL_HOST || process.env.DB_HOST || 'localhost',
    user: process.env.MYSQL_USER || process.env.DB_USER,
    password: process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.MYSQL_DATABASE || process.env.DB_NAME,
    port: Number(process.env.MYSQL_PORT || process.env.DB_PORT || 3306),
    timezone: process.env.MYSQL_TIMEZONE || '+05:30',
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 4),
    queueLimit: 0,
    namedPlaceholders: false,
  }));
}

function createSqliteDb() {
  const { DatabaseSync } = require('node:sqlite');
  return new DatabaseSync(DB_PATH);
}

class MysqlCompatDb {
  constructor(pool) {
    if (!process.env.MYSQL_USER && !process.env.DB_USER) {
      this.configError = 'MySQL mode requires MYSQL_USER and MYSQL_DATABASE.';
      this.pool = null;
      return;
    }
    this.pool = pool;
  }

  async exec(sql) {
    this.assertReady();
    for (const statement of splitSqlStatements(sql)) {
      const next = this.normalizeSql(statement);
      if (!next) continue;
      await this.pool.query(next);
    }
  }

  prepare(sql) {
    this.assertReady();
    const pragma = parsePragma(sql);
    if (pragma) return this.preparePragma(pragma);
    const normalized = this.normalizeSql(sql);
    return {
      run: (...params) => {
        return this.pool.query(normalized, normalizeMysqlParams(params)).then(([result]) => ({
          lastInsertRowid: result?.insertId || 0,
          changes: result?.affectedRows || 0,
        }));
      },
      all: (...params) => this.pool.query(normalized, normalizeMysqlParams(params)).then(([rows]) => normalizeMysqlRows(rows)),
      get: (...params) => this.pool.query(normalized, normalizeMysqlParams(params)).then(([rows]) => normalizeMysqlRows(rows)[0]),
    };
  }

  async run(sql, params = []) {
    const result = await this.pool.query(this.normalizeSql(sql), normalizeMysqlParams(params));
    return {
      lastInsertRowid: result?.[0]?.insertId || 0,
      changes: result?.[0]?.affectedRows || 0,
    };
  }

  async all(sql, params = []) {
    const [rows] = await this.pool.query(this.normalizeSql(sql), normalizeMysqlParams(params));
    return normalizeMysqlRows(rows);
  }

  async get(sql, params = []) {
    return (await this.all(sql, params))[0];
  }

  preparePragma(pragma) {
    return {
      run: async () => ({ lastInsertRowid: 0, changes: 0 }),
      get: async () => (await this.queryPragma(pragma))[0],
      all: async () => this.queryPragma(pragma),
    };
  }

  async queryPragma({ name, table }) {
    this.assertReady();
    if (name === 'table_info') {
      const [rows] = await this.pool.query(`
        SELECT COLUMN_NAME AS name
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
      `, [table]);
      return normalizeMysqlRows(rows);
    }
    if (name === 'index_list') {
      const [rows] = await this.pool.query(`
        SELECT INDEX_NAME AS name, CASE WHEN NON_UNIQUE = 0 THEN 1 ELSE 0 END AS \`unique\`
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        GROUP BY INDEX_NAME, NON_UNIQUE
      `, [table]);
      return normalizeMysqlRows(rows);
    }
    return [];
  }

  assertReady() {
    if (this.configError) throw new Error(this.configError);
    if (!this.pool) throw new Error('MySQL connection is not initialized.');
  }

  normalizeSql(sql) {
    let next = sql.trim();
    if (!next || next.startsWith('--')) return '';
    if (/^PRAGMA/i.test(next)) return '';
    next = normalizeMysqlDdl(next);
    next = normalizeMysqlUpsert(next);
    next = quoteMysqlAppSettingsKey(next);
    next = normalizeMysqlExpressions(next);
    next = next.replace(/DATE\('now'\)/gi, 'CURRENT_DATE()');
    return next;
  }
}

class SqliteCompatDb {
  constructor(dbInstance) {
    this.db = dbInstance;
  }

  exec(sql) {
    return this.db.exec(sql);
  }

  prepare(sql) {
    return this.db.prepare(sql);
  }

  run(sql, params = []) {
    const result = this.db.prepare(sql).run(...params);
    return {
      lastInsertRowid: result?.lastInsertRowid || 0,
      changes: result?.changes || 0,
    };
  }

  all(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }

  get(sql, params = []) {
    return this.db.prepare(sql).get(...params);
  }
}

/*
  The MySQL adapter intentionally uses mysql2/promise. Hostinger shared Node
  hosting cannot run sync-mysql's sync-rpc child worker reliably, which caused
  nodeNC startup failures during database init.
*/

class LegacyMysqlCompatDb {
  prepare() {
    return {
      run: () => {
        return {
          lastInsertRowid: 0,
          changes: 0,
        };
      },
      all: () => [],
      get: () => undefined,
    };
  }
  normalizeSql(sql) {
    let next = sql.trim();
    if (!next || next.startsWith('--')) return '';
    if (/^PRAGMA/i.test(next)) return '';
    next = normalizeMysqlDdl(next);
    next = normalizeMysqlUpsert(next);
    next = quoteMysqlAppSettingsKey(next);
    next = normalizeMysqlExpressions(next);
    next = next.replace(/DATE\('now'\)/gi, 'CURRENT_DATE()');
    return next;
  }
}

function splitSqlStatements(sql) {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function parsePragma(sql) {
  const text = sql.trim();
  let match = text.match(/^PRAGMA\s+table_info\((\w+)\)/i);
  if (match) return { name: 'table_info', table: match[1] };
  match = text.match(/^PRAGMA\s+index_list\((\w+)\)/i);
  if (match) return { name: 'index_list', table: match[1] };
  return null;
}

function normalizeMysqlRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({ ...row }));
}

function normalizeMysqlParams(params) {
  return params.map((value) => (value === undefined ? null : value));
}

function normalizeMysqlDdl(sql) {
  if (!/^CREATE TABLE/i.test(sql) && !/^ALTER TABLE/i.test(sql)) return sql;
  let next = stripMysqlCheckConstraints(sql)
    .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'INT NOT NULL AUTO_INCREMENT PRIMARY KEY')
    .replace(/\bINTEGER\b/gi, 'INT')
    .replace(/\bREAL\b/gi, 'DOUBLE')
    .replace(/\bTEXT\b/gi, 'VARCHAR(255)')
    .replace(/\braw_json VARCHAR\(255\)/gi, 'raw_json LONGTEXT')
    .replace(/\bstats_json VARCHAR\(255\)/gi, 'stats_json LONGTEXT')
    .replace(/\btrades_json VARCHAR\(255\)/gi, 'trades_json LONGTEXT')
    .replace(/\bsettings_json VARCHAR\(255\) NOT NULL DEFAULT '\{\}'/gi, "settings_json LONGTEXT NOT NULL")
    .replace(/\bsettings_json VARCHAR\(255\)/gi, 'settings_json LONGTEXT')
    .replace(/\bvalue VARCHAR\(255\)/gi, 'value LONGTEXT')
    .replace(/\baccess_token VARCHAR\(255\)/gi, 'access_token LONGTEXT')
    .replace(/\brefresh_token VARCHAR\(255\)/gi, 'refresh_token LONGTEXT')
    .replace(/\bauth_code VARCHAR\(255\)/gi, 'auth_code LONGTEXT')
    .replace(/\bmessage VARCHAR\(255\)/gi, 'message TEXT')
    .replace(/(\w+_at) VARCHAR\(255\) NOT NULL DEFAULT CURRENT_TIMESTAMP/gi, '$1 DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP')
    .replace(/(\w+_at) VARCHAR\(255\)/gi, '$1 DATETIME')
    .replace(/\btrade_date VARCHAR\(255\)/gi, 'trade_date DATE')
    .replace(/\brange_from VARCHAR\(255\)/gi, 'range_from DATE')
    .replace(/\brange_to VARCHAR\(255\)/gi, 'range_to DATE');
  if (/^CREATE TABLE/i.test(next)) next = `${next} ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
  return next;
}

function stripMysqlCheckConstraints(sql) {
  let output = '';
  for (let index = 0; index < sql.length; index += 1) {
    if (sql.slice(index, index + 5).toUpperCase() !== 'CHECK') {
      output += sql[index];
      continue;
    }
    let cursor = index + 5;
    while (/\s/.test(sql[cursor] || '')) cursor += 1;
    if (sql[cursor] !== '(') {
      output += sql[index];
      continue;
    }
    let depth = 0;
    for (; cursor < sql.length; cursor += 1) {
      if (sql[cursor] === '(') depth += 1;
      if (sql[cursor] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    index = cursor;
  }
  return output.replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ');
}

function normalizeMysqlUpsert(sql) {
  let next = sql;
  if (/ON CONFLICT\s*\([^)]+\)\s*DO NOTHING/i.test(next)) {
    return next
      .replace(/^INSERT INTO/i, 'INSERT IGNORE INTO')
      .replace(/\s+ON CONFLICT\s*\([^)]+\)\s*DO NOTHING/i, '');
  }
  if (/ON CONFLICT\s*\([^)]+\)\s*DO UPDATE SET/i.test(next)) {
    next = next.replace(/\s+ON CONFLICT\s*\([^)]+\)\s*DO UPDATE SET/i, ' ON DUPLICATE KEY UPDATE');
    next = next.replace(/excluded\.([a-zA-Z0-9_]+)/g, 'VALUES($1)');
  }
  return next;
}

function quoteMysqlAppSettingsKey(sql) {
  return sql
    .replace(/CREATE TABLE IF NOT EXISTS app_settings\s*\(\s*key\b/i, 'CREATE TABLE IF NOT EXISTS app_settings (`key`')
    .replace(/INSERT( IGNORE)? INTO app_settings\(key,/gi, 'INSERT$1 INTO app_settings(`key`,')
    .replace(/SELECT key, value FROM app_settings/gi, 'SELECT `key`, value FROM app_settings')
    .replace(/ORDER BY key\b/gi, 'ORDER BY `key`');
}

function normalizeMysqlExpressions(sql) {
  return sql.replace(
    /ub\.broker\s*\|\|\s*':'\s*\|\|\s*CASE WHEN ub\.is_active = 1 THEN 'active' ELSE 'saved' END/gi,
    "CONCAT(ub.broker, ':', CASE WHEN ub.is_active = 1 THEN 'active' ELSE 'saved' END)",
  );
}

db = isMysql ? createMysqlDb() : new SqliteCompatDb(createSqliteDb());

if (!isMysql) {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
}

export async function initDatabase() {
  await db.exec(`
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

  await applyLightweightMigrations();
  await seedDefaults();
}

async function applyLightweightMigrations() {
  const columns = (await db.prepare('PRAGMA table_info(users)').all()).map((column) => column.name);
  const migrations = [
    ['intraday_wallet', 'ALTER TABLE users ADD COLUMN intraday_wallet REAL NOT NULL DEFAULT 100000'],
    ['swing_wallet', 'ALTER TABLE users ADD COLUMN swing_wallet REAL NOT NULL DEFAULT 100000'],
    ['total_realized_pnl', 'ALTER TABLE users ADD COLUMN total_realized_pnl REAL NOT NULL DEFAULT 0'],
  ];

  for (const [column, sql] of migrations) {
    if (!columns.includes(column)) await db.exec(sql);
  }

  await migrateUserBrokersForMultipleAccounts();
  await addColumnIfMissing('user_brokers', 'label', 'ALTER TABLE user_brokers ADD COLUMN label TEXT');
  await addColumnIfMissing('user_brokers', 'is_active', 'ALTER TABLE user_brokers ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissing('instruments', 'last_sync_at', 'ALTER TABLE instruments ADD COLUMN last_sync_at TEXT');
  await addColumnIfMissing('instruments', 'sync_status', "ALTER TABLE instruments ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'idle'");
  await addColumnIfMissing('instruments', 'sync_progress', 'ALTER TABLE instruments ADD COLUMN sync_progress INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissing('strategy_catalog', 'settings_json', "ALTER TABLE strategy_catalog ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}'");
}

async function addColumnIfMissing(table, column, sql) {
  const columns = (await db.prepare(`PRAGMA table_info(${table})`).all()).map((item) => item.name);
  if (!columns.includes(column)) await db.exec(sql);
}

async function migrateUserBrokersForMultipleAccounts() {
  if (isMysql) return;
  const indexes = await db.prepare('PRAGMA index_list(user_brokers)').all();
  const hasUniqueBrokerIndex = indexes.some((item) => item.unique === 1);
  if (!hasUniqueBrokerIndex) return;

  await db.exec(`
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

async function seedDefaults() {
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
    ['frontend_url', process.env.FRONTEND_URL || 'https://algo.foodcrisis.in'],
    ['public_api_base', process.env.PUBLIC_API_BASE || 'http://localhost:8080'],
  ];

  const stmt = db.prepare(`
    INSERT INTO app_settings(key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO NOTHING
  `);
  for (const [key, value] of defaults) {
    await stmt.run(key, value);
  }

  const strategies = [
    ['intraday_gann_15m', 'GANN Breakout Intraday', 'intraday', 'BOTH', '15m', 50000, JSON.stringify({ emaFilter: false, targetLevels: [1, 2, 3, 4, 5] }), '15-minute GANN breakout strategy for intraday momentum.'],
    ['intraday_ha_doji_gann_15m', 'Heikin Ashi Doji Intraday', 'intraday', 'BOTH', '15m', 50000, JSON.stringify({ emaFilter: true, targetLevels: [2] }), '15-minute Heikin Ashi doji continuation strategy.'],
    ['swing_gann_daily', 'GANN Swing Continuation', 'swing', 'BUY', '1D', 100000, JSON.stringify({ emaFilter: true, targetLevels: [1, 2, 3, 4, 5] }), 'Daily GANN swing continuation strategy.'],
    ['swing_ha_doji_gann', 'Heikin Ashi Doji Swing', 'swing', 'BUY', '1D', 100000, JSON.stringify({ emaFilter: true, targetLevels: [2] }), 'Daily Heikin Ashi doji swing continuation strategy.'],
  ];
  const strategyStmt = db.prepare(`
    INSERT INTO strategy_catalog(code, name, mode, direction, timeframe, min_capital, settings_json, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO NOTHING
  `);
  for (const strategy of strategies) {
    await strategyStmt.run(...strategy);
  }
}

export function getDb() {
  return db;
}

export function getDbInfo() {
  return {
    client: isMysql ? 'mysql' : 'sqlite',
    database: isMysql ? (process.env.MYSQL_DATABASE || process.env.DB_NAME || null) : DB_PATH,
    host: isMysql ? (process.env.MYSQL_HOST || process.env.DB_HOST || 'localhost') : null,
  };
}

export function nowIso() {
  if (isMysql) {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
  }
  return new Date().toISOString();
}

export function normalizeMysqlSqlForTest(sql) {
  const compat = Object.create(MysqlCompatDb.prototype);
  return compat.normalizeSql(sql);
}
