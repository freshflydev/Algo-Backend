import moment from 'moment-timezone';
import FyersAPI from 'fyers-api-v3';
import { getDb, nowIso } from '../db/database.js';
import { createRequestQuery, getHistoryQuotes, transformCandel } from './candle.service.js';
import { arraysToCandles } from '../util/Indicators.js';
import { calculateGannLevels } from '../util/GannLevels.js';
import { runIntradayGannStrategy, runIntradayHaDojiGannStrategy, runSwingGannStrategy, runSwingHaDojiGannStrategy } from './strategyEngine.service.js';
import { DEFAULT_STOCKS_NAMES } from '../Config.js';

moment.tz.setDefault('Asia/Kolkata');

export function getSettings() {
  const rows = getDb().prepare('SELECT key, value FROM app_settings ORDER BY key').all();
  return rows.reduce((acc, row) => {
    acc[row.key] = parseSetting(row.value);
    return acc;
  }, {});
}

export function updateSettings(settings) {
  const stmt = getDb().prepare(`
    INSERT INTO app_settings(key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  Object.entries(settings || {}).forEach(([key, value]) => {
    stmt.run(key, String(value), nowIso());
  });
  return getSettings();
}

export function addInstrument({ symbol, category = 'stock', segment = 'NSE', instrumentType = '-EQ' }) {
  const normalized = symbol.toUpperCase();
  const derived = inferInstrumentDefaults(normalized, { category, segment, instrumentType });
  getDb().prepare(`
    INSERT INTO instruments(symbol, segment, instrument_type, category, sync_status, sync_progress)
    VALUES (?, ?, ?, ?, 'idle', 0)
    ON CONFLICT(symbol) DO UPDATE SET enabled = 1, segment = excluded.segment, instrument_type = excluded.instrument_type, category = excluded.category
  `).run(normalized, derived.segment, derived.instrumentType, derived.category);
  return getInstrument(normalized);
}

export function addInstrumentWithInitialSync(payload) {
  const instrument = addInstrument(payload);
  const rangeTo = moment().format('YYYY-MM-DD');
  const rangeFrom = moment().subtract(2, 'months').format('YYYY-MM-DD');
  fetchAndStoreCandles({ symbol: instrument.symbol, resolution: 'D', rangeFrom, rangeTo })
    .catch((error) => {
      markInstrumentSync(instrument.symbol, 'error', 0);
      console.error(`Initial sync failed for ${instrument.symbol}:`, error.message || error);
    });
  return { ...instrument, sync_status: 'syncing', sync_progress: 0 };
}

export function listInstruments(category) {
  seedDefaultInstruments();
  const selectSql = `
    SELECT
      i.*,
      d.current_trend AS latest_trend,
      d.atr_trend AS latest_ha_swing_trend,
      d.consecutive_days AS continuation_days,
      d.stop_loss AS latest_stop_loss,
      d.trade_date AS latest_trend_date
    FROM instruments i
    LEFT JOIN daily_trend_analysis d ON d.id = (
      SELECT id FROM daily_trend_analysis
      WHERE symbol = i.symbol
      ORDER BY trade_date DESC
      LIMIT 1
    )
    WHERE i.enabled = 1
  `;
  if (category) {
    return getDb().prepare(`${selectSql} AND i.category = ? ORDER BY i.symbol`).all(category);
  }
  return getDb().prepare(`${selectSql} ORDER BY i.category, i.symbol`).all();
}

export function disableInstrument(symbol) {
  getDb().prepare('UPDATE instruments SET enabled = 0 WHERE symbol = ?').run(symbol.toUpperCase());
  return listInstruments();
}

export function upsertUser({ mobile, name, targetLevel = 1 }) {
  getDb().prepare(`
    INSERT INTO users(mobile, name, target_level, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(mobile) DO UPDATE SET name = excluded.name, target_level = excluded.target_level, updated_at = excluded.updated_at
  `).run(mobile, name || null, normalizeTargetLevel(targetLevel), nowIso());
  const user = getUserByMobile(mobile);
  ensureUserStrategyConfig(user.id);
  ensureDefaultSubscriptions(user.id);
  return user;
}

export function loginWithMobile({ mobile, name }) {
  if (!mobile) throw new Error('Mobile is required.');
  const role = mobile === '9999999999' ? 'admin' : 'user';
  let user = getUserByMobile(mobile);
  if (!user) user = upsertUser({ mobile, name: name || (role === 'admin' ? 'Admin' : null) });
  ensureUserStrategyConfig(user.id);
  ensureDefaultSubscriptions(user.id);
  recordLogin(user.id, mobile, role, 'success', 'Mobile login');
  return { role, user, lastLoginAt: lastLoginAt(mobile) };
}

export function listLoginHistory({ mobile, limit = 20 } = {}) {
  const params = [];
  const where = mobile ? 'WHERE mobile = ?' : '';
  if (mobile) params.push(mobile);
  params.push(Number(limit || 20));
  return getDb().prepare(`
    SELECT mobile, role, status, message, created_at
    FROM login_history
    ${where}
    ORDER BY id DESC
    LIMIT ?
  `).all(...params);
}

export function getUserStrategyConfig(mobile) {
  const user = requireUser(mobile);
  ensureUserStrategyConfig(user.id);
  return getDb().prepare('SELECT * FROM user_strategy_configs WHERE user_id = ?').get(user.id);
}

export function updateUserStrategyConfig(mobile, config) {
  const user = requireUser(mobile);
  ensureUserStrategyConfig(user.id);
  const current = getUserStrategyConfig(mobile);
  const next = {
    intraday_enabled: toDbBool(config.intradayEnabled ?? current.intraday_enabled),
    intraday_scope: config.intradayScope || current.intraday_scope,
    intraday_direction: config.intradayDirection || current.intraday_direction,
    intraday_trade_amount: Number(config.intradayTradeAmount ?? current.intraday_trade_amount),
    intraday_leverage: Number(config.intradayLeverage ?? current.intraday_leverage),
    intraday_fresh_trend_only: toDbBool(config.intradayFreshTrendOnly ?? current.intraday_fresh_trend_only),
    swing_enabled: toDbBool(config.swingEnabled ?? current.swing_enabled),
    swing_scope: config.swingScope || current.swing_scope,
    swing_trade_amount: Number(config.swingTradeAmount ?? current.swing_trade_amount),
    swing_leverage: Number(config.swingLeverage ?? current.swing_leverage),
  };

  getDb().prepare(`
    UPDATE user_strategy_configs SET
      intraday_enabled = ?,
      intraday_scope = ?,
      intraday_direction = ?,
      intraday_trade_amount = ?,
      intraday_leverage = ?,
      intraday_fresh_trend_only = ?,
      swing_enabled = ?,
      swing_scope = ?,
      swing_trade_amount = ?,
      swing_leverage = ?,
      updated_at = ?
    WHERE user_id = ?
  `).run(
    next.intraday_enabled,
    next.intraday_scope,
    next.intraday_direction,
    next.intraday_trade_amount,
    next.intraday_leverage,
    next.intraday_fresh_trend_only,
    next.swing_enabled,
    next.swing_scope,
    next.swing_trade_amount,
    next.swing_leverage,
    nowIso(),
    user.id,
  );
  return getUserStrategyConfig(mobile);
}

export function listUserWatchlist(mobile) {
  const user = requireUser(mobile);
  return getDb().prepare(`
    SELECT symbol, watchlist_name, created_at
    FROM user_watchlists
    WHERE user_id = ?
    ORDER BY watchlist_name, symbol
  `).all(user.id);
}

export function addUserWatchlistSymbol(mobile, { symbol, watchlistName = 'default' }) {
  const user = requireUser(mobile);
  const normalized = symbol.toUpperCase();
  if (!getInstrument(normalized)) addInstrument({ symbol: normalized });
  getDb().prepare(`
    INSERT INTO user_watchlists(user_id, symbol, watchlist_name)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, symbol, watchlist_name) DO NOTHING
  `).run(user.id, normalized, watchlistName);
  return listUserWatchlist(mobile);
}

export function removeUserWatchlistSymbol(mobile, symbol, watchlistName = 'default') {
  const user = requireUser(mobile);
  getDb().prepare(`
    DELETE FROM user_watchlists
    WHERE user_id = ? AND symbol = ? AND watchlist_name = ?
  `).run(user.id, symbol.toUpperCase(), watchlistName);
  return listUserWatchlist(mobile);
}

export function updateUserBroker(mobile, payload) {
  assertBrokerMutationAllowed();
  const user = requireUser(mobile);
  const broker = payload.broker?.toLowerCase();
  if (!['fyers', 'upstox'].includes(broker)) throw new Error('Broker must be fyers or upstox.');
  if (payload.id) {
    getDb().prepare(`
      UPDATE user_brokers
      SET broker = ?, label = ?, api_key = ?, secret_key = ?, redirect_url = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(broker, payload.label || broker, payload.apiKey, payload.secretKey, payload.redirectUrl || null, nowIso(), payload.id, user.id);
    return getUserBrokerById(user.id, payload.id);
  }

  const result = getDb().prepare(`
    INSERT INTO user_brokers(user_id, broker, label, api_key, secret_key, redirect_url, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(user.id, broker, payload.label || broker, payload.apiKey, payload.secretKey, payload.redirectUrl || null, nowIso());
  return getUserBrokerById(user.id, result.lastInsertRowid);
}

export function listUserBrokers(mobile) {
  const user = requireUser(mobile);
  return getDb().prepare(`
    SELECT id, broker, label, api_key, redirect_url, token_expires_at, connected_at, is_connected, is_active, created_at, updated_at
    FROM user_brokers
    WHERE user_id = ?
    ORDER BY is_active DESC, updated_at DESC
  `).all(user.id);
}

export function setActiveUserBroker(mobile, brokerId) {
  const user = requireUser(mobile);
  const account = getUserBrokerById(user.id, brokerId);
  if (!account) throw new Error('Broker account not found.');
  getDb().prepare('UPDATE user_brokers SET is_active = 0, updated_at = ? WHERE user_id = ?').run(nowIso(), user.id);
  getDb().prepare('UPDATE user_brokers SET is_active = 1, updated_at = ? WHERE id = ? AND user_id = ?').run(nowIso(), brokerId, user.id);
  return listUserBrokers(mobile);
}

export function disconnectUserBroker(mobile, brokerId) {
  const user = requireUser(mobile);
  getDb().prepare(`
    UPDATE user_brokers
    SET is_connected = 0, access_token = NULL, refresh_token = NULL, auth_code = NULL, token_expires_at = NULL, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(nowIso(), brokerId, user.id);
  return listUserBrokers(mobile);
}

export function removeUserBroker(mobile, brokerId) {
  const user = requireUser(mobile);
  getDb().prepare('DELETE FROM user_brokers WHERE id = ? AND user_id = ?').run(brokerId, user.id);
  return listUserBrokers(mobile);
}

export async function connectUserBroker(mobile, brokerNameOrId) {
  const user = requireUser(mobile);
  const broker = Number(brokerNameOrId)
    ? getUserBrokerById(user.id, Number(brokerNameOrId))
    : getActiveOrNamedUserBroker(user.id, brokerNameOrId?.toLowerCase());
  if (!broker) throw new Error('Broker credentials not found for user.');
  if (broker.broker === 'fyers') {
    const fyers = new FyersAPI.fyersModel();
    fyers.setAppId(broker.api_key);
    fyers.setRedirectUrl(callbackUrl(broker.redirect_url, 'fyers', mobile, broker.id));
    return { broker: 'fyers', authUrl: await fyers.generateAuthCode() };
  }
  const redirectUri = encodeURIComponent(callbackUrl(broker.redirect_url, 'upstox', mobile, broker.id));
  return {
    broker: 'upstox',
    authUrl: `https://api.upstox.com/v2/login/authorization/dialog?response_type=code&client_id=${encodeURIComponent(broker.api_key)}&redirect_uri=${redirectUri}&state=${encodeURIComponent(mobile)}`,
  };
}

export async function completeUserBrokerCallback({ broker, mobile, code, brokerId }) {
  const user = requireUser(mobile);
  const account = brokerId ? getUserBrokerById(user.id, Number(brokerId)) : getActiveOrNamedUserBroker(user.id, broker);
  if (!account) throw new Error('Broker credentials not found for callback.');

  if (broker === 'fyers') {
    const fyers = new FyersAPI.fyersModel();
    fyers.setAppId(account.api_key);
    fyers.setRedirectUrl(callbackUrl(account.redirect_url, 'fyers', mobile, account.id));
    const data = await fyers.generate_access_token({
      client_id: account.api_key,
      secret_key: account.secret_key,
      auth_code: code,
    });
    if (data.code && data.code !== 200) throw new Error(data.message || 'Fyers token exchange failed.');
    saveBrokerTokens(account.id, code, data.access_token, data.refresh_token);
    return { broker, connected: true };
  }

  const response = await fetch('https://api.upstox.com/v2/login/authorization/token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      client_id: account.api_key,
      client_secret: account.secret_key,
      redirect_uri: callbackUrl(account.redirect_url, 'upstox', mobile, account.id),
      grant_type: 'authorization_code',
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.message || 'Upstox token exchange failed.');
  saveBrokerTokens(account.id, code, data.access_token, data.refresh_token);
  return { broker, connected: true };
}

export function startUserInstance(mobile) {
  assertInstanceWindow();
  const user = requireUser(mobile);
  const connectedBroker = getDb().prepare(`
    SELECT * FROM user_brokers WHERE user_id = ? AND is_connected = 1 LIMIT 1
  `).get(user.id);
  if (!connectedBroker) throw new Error('User must connect broker before starting algo.');
  getDb().prepare(`
    INSERT INTO algo_instances(user_id, status, started_at, updated_at)
    VALUES (?, 'running', ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET status = 'running', started_at = excluded.started_at, stopped_at = NULL, updated_at = excluded.updated_at
  `).run(user.id, nowIso(), nowIso());
  return getUserInstance(mobile);
}

export function stopUserInstance(mobile) {
  const user = requireUser(mobile);
  getDb().prepare(`
    INSERT INTO algo_instances(user_id, status, stopped_at, updated_at)
    VALUES (?, 'stopped', ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET status = 'stopped', stopped_at = excluded.stopped_at, updated_at = excluded.updated_at
  `).run(user.id, nowIso(), nowIso());
  return getUserInstance(mobile);
}

export function getUserInstance(mobile) {
  const user = requireUser(mobile);
  return getDb().prepare('SELECT * FROM algo_instances WHERE user_id = ?').get(user.id) || { user_id: user.id, status: 'stopped' };
}

export function listStrategiesForUser(mobile) {
  const user = requireUser(mobile);
  ensureDefaultSubscriptions(user.id);
  return getDb().prepare(`
    SELECT
      sc.*,
      us.enabled AS subscribed,
      us.target_level,
      COALESCE(perf.success_ratio, 0) AS success_rate,
      COALESCE(perf.best_symbol, '') AS best_symbol
    FROM strategy_catalog sc
    LEFT JOIN user_strategy_subscriptions us ON us.strategy_code = sc.code AND us.user_id = ?
    LEFT JOIN (
      SELECT strategy, ROUND(AVG(success_ratio), 2) AS success_ratio, symbol AS best_symbol
      FROM (
        SELECT
          strategy,
          symbol,
          json_extract(stats_json, '$.successRatio') AS success_ratio,
          ROW_NUMBER() OVER (PARTITION BY strategy ORDER BY json_extract(stats_json, '$.successRatio') DESC) AS rank_no
        FROM backtests
      )
      WHERE rank_no = 1
      GROUP BY strategy
    ) perf ON perf.strategy = sc.code
    WHERE sc.enabled = 1
    ORDER BY sc.mode, sc.name
  `).all(user.id).map(parseStrategyRow);
}

export function listUserStrategyHistory(mobile, strategyCode) {
  const user = requireUser(mobile);
  const watchlist = getDb().prepare(`
    SELECT symbol FROM user_watchlists
    WHERE user_id = ?
    ORDER BY symbol
  `).all(user.id).map((row) => row.symbol);
  const watchlistSet = new Set(watchlist);

  const trades = getDb().prepare(`
    SELECT strategy, symbol, side, quantity, entry_price, exit_price, exit_reason, status, order_tag, entered_at, exited_at
    FROM orders
    WHERE user_id = ? AND strategy = ?
    ORDER BY entered_at DESC
    LIMIT 100
  `).all(user.id, strategyCode);

  const backtests = getDb().prepare(`
    SELECT id, strategy, symbol, range_from, range_to, stats_json, created_at
    FROM backtests
    WHERE strategy = ?
    ORDER BY created_at DESC
    LIMIT 100
  `).all(strategyCode)
    .filter((row) => watchlistSet.size === 0 || watchlistSet.has(row.symbol))
    .map((row) => ({ ...row, stats: safeJson(row.stats_json), stats_json: undefined }));

  return { watchlist, trades, backtests };
}

export function updateUserStrategySubscription(mobile, strategyCode, payload) {
  const user = requireUser(mobile);
  const targetLevel = normalizeTargetLevel(payload.targetLevel || 1);
  getDb().prepare(`
    INSERT INTO user_strategy_subscriptions(user_id, strategy_code, target_level, enabled, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, strategy_code) DO UPDATE SET
      target_level = excluded.target_level,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).run(user.id, strategyCode, targetLevel, toDbBool(payload.enabled ?? true), nowIso());
  return listStrategiesForUser(mobile);
}

export function listStrategiesAdmin() {
  return getDb().prepare(`
    SELECT
      sc.*,
      COALESCE(perf.runs, 0) AS runs,
      COALESCE(perf.successRatio, 0) AS success_rate,
      COALESCE(perf.totalTrades, 0) AS total_trades
    FROM strategy_catalog sc
    LEFT JOIN (
      SELECT
        strategy,
        COUNT(*) AS runs,
        SUM(json_extract(stats_json, '$.totalTrades')) AS totalTrades,
        ROUND(AVG(json_extract(stats_json, '$.successRatio')), 2) AS successRatio
      FROM backtests
      GROUP BY strategy
    ) perf ON perf.strategy = sc.code
    ORDER BY sc.mode, sc.name
  `).all().map(parseStrategyRow);
}

export function updateStrategyAdmin(code, payload) {
  const settings = normalizeStrategySettings(payload.settings || payload.settings_json || {});
  getDb().prepare(`
    UPDATE strategy_catalog
    SET name = ?, mode = ?, direction = ?, timeframe = ?, min_capital = ?, enabled = ?, settings_json = ?, updated_at = ?
    WHERE code = ?
  `).run(
    payload.name,
    payload.mode,
    payload.direction,
    payload.timeframe,
    Number(payload.minCapital || payload.min_capital || 0),
    toDbBool(payload.enabled),
    JSON.stringify(settings),
    nowIso(),
    code,
  );
  return listStrategiesAdmin();
}

export async function fetchAndStoreCandles({ symbol, resolution = '15', rangeFrom, rangeTo, category }) {
  const instruments = selectedSymbols(symbol, category);
  const stored = [];
  for (let index = 0; index < instruments.length; index++) {
    const instrument = instruments[index];
    markInstrumentSync(instrument.symbol, 'syncing', Math.round(index / instruments.length * 100));
    const param = {
      instrument: instrument.symbol,
      segment: instrument.segment,
      type: instrument.instrument_type,
      timeframe: resolution,
      date: rangeFrom,
    };
    const query = createRequestQuery(param);
    query.range_from = rangeFrom;
    query.range_to = rangeTo || rangeFrom;
    await waitRateLimit();
    const history = await getHistoryQuotes(query);
    const data = transformCandel(history);
    const candles = arraysToCandles(data);
    storeCandles(instrument.symbol, resolution, candles);
    markInstrumentSync(instrument.symbol, 'idle', 100);
    stored.push({ symbol: instrument.symbol, count: candles.length });
  }
  return stored;
}

export async function calculateAndStoreDailyGannLevels({ symbol, category, tradeDate, sourceKind = 'day_open' }) {
  const instruments = selectedSymbols(symbol, category);
  const date = tradeDate || moment().format('YYYY-MM-DD');
  const results = [];
  for (const instrument of instruments) {
    let candles = getStoredCandles(instrument.symbol, '15', date, date);
    if (candles.length === 0) {
      await fetchAndStoreCandles({ symbol: instrument.symbol, resolution: '15', rangeFrom: date, rangeTo: date });
      candles = getStoredCandles(instrument.symbol, '15', date, date);
    }
    if (candles.length === 0) continue;
    const sourcePrice = candles[0].open;
    const levels = calculateGannLevels(sourcePrice);
    upsertGannLevel(instrument.symbol, date, sourceKind, levels);
    results.push({ symbol: instrument.symbol, tradeDate: date, levels });
  }
  return results;
}

export async function backtestIntraday({ symbol, category, rangeFrom, rangeTo, targetLevel, useEma, slippagePercent, costPercent, sameCandlePolicy }) {
  const instruments = selectedSymbols(symbol, category);
  const results = [];
  const maxCandleRangePercent = Number(getSettings().spike_candle_percent || 1.2);
  for (const instrument of instruments) {
    let candles = getStoredCandles(instrument.symbol, '15', rangeFrom, rangeTo);
    if (candles.length === 0) {
      await fetchAndStoreCandles({ symbol: instrument.symbol, resolution: '15', rangeFrom, rangeTo });
      candles = getStoredCandles(instrument.symbol, '15', rangeFrom, rangeTo);
    }
    const result = runIntradayGannStrategy(candles, { targetLevel, useEma, slippagePercent, costPercent, sameCandlePolicy, maxCandleRangePercent });
    storeBacktest('intraday_gann_15m', instrument.symbol, rangeFrom, rangeTo, result);
    results.push({ symbol: instrument.symbol, ...result });
  }
  return results;
}

export async function backtestSwing({ symbol, category, rangeFrom, rangeTo, targetLevel, useEma, slippagePercent, costPercent, sameCandlePolicy }) {
  const instruments = selectedSymbols(symbol, category);
  const results = [];
  const maxCandleRangePercent = Number(getSettings().spike_candle_percent || 1.2);
  for (const instrument of instruments) {
    const fromWithWarmup = moment(rangeFrom).subtract(35, 'days').format('YYYY-MM-DD');
    let candles = getStoredCandles(instrument.symbol, 'D', fromWithWarmup, rangeTo);
    if (candles.length === 0) {
      await fetchAndStoreCandles({ symbol: instrument.symbol, resolution: 'D', rangeFrom: fromWithWarmup, rangeTo });
      candles = getStoredCandles(instrument.symbol, 'D', fromWithWarmup, rangeTo);
    }
    const result = runSwingGannStrategy(candles, { targetLevel, useEma, slippagePercent, costPercent, sameCandlePolicy, maxCandleRangePercent });
    storeBacktest('swing_gann_daily', instrument.symbol, rangeFrom, rangeTo, result);
    results.push({ symbol: instrument.symbol, ...result });
  }
  return results;
}

export async function backtestSwingHaDoji({ symbol, category, rangeFrom, rangeTo, useEma, slippagePercent, costPercent, sameCandlePolicy }) {
  const instruments = selectedSymbols(symbol, category);
  const results = [];
  const maxCandleRangePercent = Number(getSettings().spike_candle_percent || 1.2);
  for (const instrument of instruments) {
    const fromWithWarmup = moment(rangeFrom).subtract(35, 'days').format('YYYY-MM-DD');
    let candles = getStoredCandles(instrument.symbol, 'D', fromWithWarmup, rangeTo);
    if (candles.length === 0) {
      await fetchAndStoreCandles({ symbol: instrument.symbol, resolution: 'D', rangeFrom: fromWithWarmup, rangeTo });
      candles = getStoredCandles(instrument.symbol, 'D', fromWithWarmup, rangeTo);
    }
    const result = runSwingHaDojiGannStrategy(candles, { useEma, slippagePercent, costPercent, sameCandlePolicy, maxCandleRangePercent });
    storeBacktest('swing_ha_doji_gann', instrument.symbol, rangeFrom, rangeTo, result);
    results.push({ symbol: instrument.symbol, ...result });
  }
  return results;
}

export async function backtestIntradayHaDoji({ symbol, category, rangeFrom, rangeTo, useEma, slippagePercent, costPercent, sameCandlePolicy }) {
  const instruments = selectedSymbols(symbol, category);
  const results = [];
  const maxCandleRangePercent = Number(getSettings().spike_candle_percent || 1.2);
  for (const instrument of instruments) {
    let candles = getStoredCandles(instrument.symbol, '15', rangeFrom, rangeTo);
    if (candles.length === 0) {
      await fetchAndStoreCandles({ symbol: instrument.symbol, resolution: '15', rangeFrom, rangeTo });
      candles = getStoredCandles(instrument.symbol, '15', rangeFrom, rangeTo);
    }
    const result = runIntradayHaDojiGannStrategy(candles, { useEma, slippagePercent, costPercent, sameCandlePolicy, maxCandleRangePercent });
    storeBacktest('intraday_ha_doji_gann_15m', instrument.symbol, rangeFrom, rangeTo, result);
    results.push({ symbol: instrument.symbol, ...result });
  }
  return results;
}

export async function backtestStrategyMatrix({ symbol, category = 'stock', rangeFrom, rangeTo, slippagePercent, costPercent, sameCandlePolicy }) {
  const strategies = listStrategiesAdmin().filter((strategy) => strategy.enabled);
  const matrix = [];
  for (const strategy of strategies) {
    const targetLevels = strategy.settings?.targetLevels?.length ? strategy.settings.targetLevels : [1];
    const emaVariants = strategy.settings?.emaFilter === 'both' ? [false, true] : [Boolean(strategy.settings?.emaFilter)];
    for (const useEma of emaVariants) {
      const levels = strategy.code.includes('ha_doji') ? [2] : targetLevels;
      for (const targetLevel of levels) {
        const options = { symbol, category, rangeFrom, rangeTo, targetLevel, useEma, slippagePercent, costPercent, sameCandlePolicy };
        const rows = await runBacktestByStrategy(strategy.code, options);
        rows.forEach((row) => matrix.push({
          variant: `${strategy.code}${useEma ? '_ema' : '_no_ema'}_t${targetLevel}`,
          strategy: strategy.code,
          useEma,
          targetLevel,
          symbol: row.symbol,
          ...row.stats,
        }));
      }
    }
  }
  return matrix.sort((a, b) => Number(b.successRatio || 0) - Number(a.successRatio || 0));
}

export function listTrades(filters = {}) {
  const conditions = [];
  const params = [];
  if (filters.mobile) {
    conditions.push('u.mobile = ?');
    params.push(filters.mobile);
  }
  if (filters.strategy) {
    conditions.push('o.strategy = ?');
    params.push(filters.strategy);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return getDb().prepare(`
    SELECT o.*, u.mobile
    FROM orders o
    JOIN users u ON u.id = o.user_id
    ${where}
    ORDER BY o.created_at DESC
    LIMIT 500
  `).all(...params);
}

export function getActiveUsers() {
  return getDb().prepare(`
    SELECT u.*, ub.broker, ub.access_token, ub.api_key, ub.secret_key
    FROM users u
    JOIN algo_instances ai ON ai.user_id = u.id AND ai.status = 'running'
    JOIN user_brokers ub ON ub.user_id = u.id AND ub.is_connected = 1
    WHERE u.is_active = 1
  `).all();
}

export function storeCandles(symbol, resolution, candles) {
  const stmt = getDb().prepare(`
    INSERT INTO candles(symbol, resolution, candle_time, trade_date, open, high, low, close, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(symbol, resolution, candle_time) DO UPDATE SET
      open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close, volume = excluded.volume
  `);
  candles.forEach((candle) => {
    const tradeDate = moment.unix(candle.time).tz('Asia/Kolkata').format('YYYY-MM-DD');
    stmt.run(symbol, resolution, candle.time, tradeDate, candle.open, candle.high, candle.low, candle.close, candle.volume || 0);
  });
}

export function getStoredCandles(symbol, resolution, rangeFrom, rangeTo) {
  return getDb().prepare(`
    SELECT candle_time as time, open, high, low, close, volume
    FROM candles
    WHERE symbol = ? AND resolution = ? AND trade_date BETWEEN ? AND ?
    ORDER BY candle_time ASC
  `).all(symbol, resolution, rangeFrom, rangeTo);
}

export function upsertGannLevel(symbol, tradeDate, sourceKind, levels) {
  getDb().prepare(`
    INSERT INTO gann_levels(
      symbol, trade_date, source_price, source_kind, buy, buy_sl,
      buy_target1, buy_target2, buy_target3, buy_target4, buy_target5,
      sell, sell_sl, sell_target1, sell_target2, sell_target3, sell_target4, sell_target5, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(symbol, trade_date) DO UPDATE SET
      source_price = excluded.source_price,
      source_kind = excluded.source_kind,
      buy = excluded.buy,
      buy_sl = excluded.buy_sl,
      buy_target1 = excluded.buy_target1,
      buy_target2 = excluded.buy_target2,
      buy_target3 = excluded.buy_target3,
      buy_target4 = excluded.buy_target4,
      buy_target5 = excluded.buy_target5,
      sell = excluded.sell,
      sell_sl = excluded.sell_sl,
      sell_target1 = excluded.sell_target1,
      sell_target2 = excluded.sell_target2,
      sell_target3 = excluded.sell_target3,
      sell_target4 = excluded.sell_target4,
      sell_target5 = excluded.sell_target5,
      raw_json = excluded.raw_json
  `).run(
    symbol, tradeDate, levels.sourcePrice, sourceKind, levels.buy, levels.buySl,
    levels.buyTargets[0], levels.buyTargets[1], levels.buyTargets[2], levels.buyTargets[3], levels.buyTargets[4],
    levels.sell, levels.sellSl,
    levels.sellTargets[0], levels.sellTargets[1], levels.sellTargets[2], levels.sellTargets[3], levels.sellTargets[4],
    JSON.stringify(levels),
  );
}

function storeBacktest(strategy, symbol, rangeFrom, rangeTo, result) {
  getDb().prepare(`
    INSERT INTO backtests(strategy, symbol, range_from, range_to, stats_json, trades_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(strategy, symbol, rangeFrom, rangeTo, JSON.stringify(result.stats), JSON.stringify(result.trades));
}

async function runBacktestByStrategy(strategyCode, options) {
  if (strategyCode === 'intraday_gann_15m') return backtestIntraday(options);
  if (strategyCode === 'intraday_ha_doji_gann_15m') return backtestIntradayHaDoji(options);
  if (strategyCode === 'swing_ha_doji_gann') return backtestSwingHaDoji(options);
  return backtestSwing(options);
}

function parseStrategyRow(row) {
  return { ...row, settings: normalizeStrategySettings(row.settings_json) };
}

function normalizeStrategySettings(value) {
  const parsed = typeof value === 'string' ? safeJson(value) : value || {};
  return {
    emaFilter: parsed.emaFilter ?? false,
    targetLevels: Array.isArray(parsed.targetLevels) && parsed.targetLevels.length ? parsed.targetLevels.map(Number) : [1, 2, 3, 4, 5],
  };
}

function safeJson(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function selectedSymbols(symbol, category) {
  seedDefaultInstruments();
  if (symbol) return [getInstrument(symbol.toUpperCase()) || addInstrument({ symbol })];
  return listInstruments(category);
}

function inferInstrumentDefaults(symbol, fallback) {
  const indices = new Set(['NIFTY50', 'NIFTYBANK', 'FINNIFTY', 'SENSEX']);
  const commodities = new Set(['CRUDEOIL', 'GOLD', 'SILVER', 'NATURALGAS']);
  if (indices.has(symbol)) return { category: 'index', segment: 'NSE', instrumentType: '-INDEX' };
  if (commodities.has(symbol)) return { category: 'commodity', segment: 'MCX', instrumentType: 'FUT' };
  return {
    category: fallback.category || 'stock',
    segment: fallback.segment || 'NSE',
    instrumentType: fallback.instrumentType || '-EQ',
  };
}

function getInstrument(symbol) {
  return getDb().prepare('SELECT * FROM instruments WHERE symbol = ?').get(symbol);
}

function getUserByMobile(mobile) {
  return getDb().prepare('SELECT * FROM users WHERE mobile = ?').get(mobile);
}

function requireUser(mobile) {
  const user = getUserByMobile(mobile);
  if (!user) throw new Error('User not found.');
  return user;
}

function getUserBroker(userId, broker) {
  return getDb().prepare('SELECT * FROM user_brokers WHERE user_id = ? AND broker = ?').get(userId, broker);
}

function getUserBrokerById(userId, brokerId) {
  return getDb().prepare('SELECT * FROM user_brokers WHERE user_id = ? AND id = ?').get(userId, brokerId);
}

function getActiveOrNamedUserBroker(userId, broker) {
  if (Number(broker)) return getUserBrokerById(userId, Number(broker));
  return getDb().prepare(`
    SELECT * FROM user_brokers
    WHERE user_id = ? AND broker = ?
    ORDER BY is_active DESC, updated_at DESC
    LIMIT 1
  `).get(userId, broker);
}

function ensureUserStrategyConfig(userId) {
  getDb().prepare(`
    INSERT INTO user_strategy_configs(user_id)
    VALUES (?)
    ON CONFLICT(user_id) DO NOTHING
  `).run(userId);
}

function ensureDefaultSubscriptions(userId) {
  const strategies = getDb().prepare('SELECT code FROM strategy_catalog WHERE enabled = 1').all();
  const stmt = getDb().prepare(`
    INSERT INTO user_strategy_subscriptions(user_id, strategy_code, enabled)
    VALUES (?, ?, 0)
    ON CONFLICT(user_id, strategy_code) DO NOTHING
  `);
  strategies.forEach((strategy) => stmt.run(userId, strategy.code));
}

function saveBrokerTokens(accountId, authCode, accessToken, refreshToken) {
  getDb().prepare(`
    UPDATE user_brokers
    SET auth_code = ?, access_token = ?, refresh_token = ?, token_expires_at = ?, connected_at = ?, is_connected = 1, is_active = 1, updated_at = ?
    WHERE id = ?
  `).run(authCode, accessToken, refreshToken || null, moment().add(20, 'hours').toISOString(), nowIso(), nowIso(), accountId);
  const row = getDb().prepare('SELECT user_id FROM user_brokers WHERE id = ?').get(accountId);
  if (row) getDb().prepare('UPDATE user_brokers SET is_active = 0 WHERE user_id = ? AND id != ?').run(row.user_id, accountId);
}

function callbackUrl(configuredUrl, broker, mobile, brokerId) {
  const base = configuredUrl || `http://localhost:8080/api/callback/${broker}`;
  const url = new URL(base);
  url.searchParams.set('mobile', mobile);
  if (brokerId) url.searchParams.set('brokerId', brokerId);
  return url.toString();
}

function seedDefaultInstruments() {
  const count = getDb().prepare('SELECT COUNT(*) as count FROM instruments').get().count;
  if (count > 0) return;
  DEFAULT_STOCKS_NAMES.forEach((symbol) => addInstrument({ symbol, category: 'stock' }));
  ['NIFTY50', 'NIFTYBANK'].forEach((symbol) => addInstrument({ symbol, category: 'index', instrumentType: '-INDEX' }));
  ['CRUDEOIL', 'GOLD'].forEach((symbol) => addInstrument({ symbol, category: 'commodity', segment: 'MCX', instrumentType: 'FUT' }));
}

function assertBrokerMutationAllowed() {
  const now = moment();
  const start = moment({ hour: 8, minute: 0 });
  const end = moment({ hour: 15, minute: 30 });
  if (now.isBetween(start, end, undefined, '[]')) {
    throw new Error('Broker settings cannot be modified between 08:00 and 15:30 IST.');
  }
}

function assertInstanceWindow() {
  const now = moment();
  const start = moment({ hour: 8, minute: 0 });
  const end = moment({ hour: 15, minute: 30 });
  if (!now.isBetween(start, end, undefined, '[]')) {
    throw new Error('Algo instance can be started only between 08:00 and 15:30 IST.');
  }
}

function parseSetting(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value !== '' && !Number.isNaN(Number(value))) return Number(value);
  return value;
}

function normalizeTargetLevel(value) {
  const target = Number(value || 1);
  return Number.isInteger(target) && target >= 1 && target <= 5 ? target : 1;
}

function toDbBool(value) {
  return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
}

function markInstrumentSync(symbol, status, progress) {
  getDb().prepare(`
    UPDATE instruments
    SET sync_status = ?, sync_progress = ?, last_sync_at = CASE WHEN ? = 'idle' THEN ? ELSE last_sync_at END
    WHERE symbol = ?
  `).run(status, progress, status, nowIso(), symbol);
}

function recordLogin(userId, mobile, role, status, message) {
  getDb().prepare(`
    INSERT INTO login_history(user_id, mobile, role, status, message)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, mobile, role, status, message);
}

function lastLoginAt(mobile) {
  return getDb().prepare(`
    SELECT created_at FROM login_history
    WHERE mobile = ?
    ORDER BY id DESC
    LIMIT 1 OFFSET 1
  `).get(mobile)?.created_at || null;
}

function waitRateLimit(ms = 350) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
