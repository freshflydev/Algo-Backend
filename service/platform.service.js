import moment from 'moment-timezone';
import FyersAPI from 'fyers-api-v3';
import { getDb, nowIso } from '../db/database.js';
import { createRequestQuery, getHistoryQuotes, transformCandel } from './candle.service.js';
import { arraysToCandles } from '../util/Indicators.js';
import { calculateGannLevels } from '../util/GannLevels.js';
import { runIntradayGannStrategy, runIntradayHaDojiGannStrategy, runSwingGannStrategy, runSwingHaDojiGannStrategy } from './strategyEngine.service.js';
import { DEFAULT_STOCKS_NAMES } from '../Config.js';

moment.tz.setDefault('Asia/Kolkata');

export async function getSettings() {
  const rows = await getDb().prepare('SELECT key, value FROM app_settings ORDER BY key').all();
  return rows.reduce((acc, row) => {
    acc[row.key] = parseSetting(row.value);
    return acc;
  }, {});
}

export async function updateSettings(settings) {
  const stmt = getDb().prepare(`
    INSERT INTO app_settings(key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  for (const [key, value] of Object.entries(settings || {})) {
    await stmt.run(key, String(value), nowIso());
  }
  await syncAdminBrokerSettings(settings);
  return getSettings();
}

export async function addInstrument({ symbol, category = 'stock', segment = 'NSE', instrumentType = '-EQ' }) {
  const normalized = symbol.toUpperCase();
  const derived = inferInstrumentDefaults(normalized, { category, segment, instrumentType });
  await getDb().prepare(`
    INSERT INTO instruments(symbol, segment, instrument_type, category, sync_status, sync_progress)
    VALUES (?, ?, ?, ?, 'idle', 0)
    ON CONFLICT(symbol) DO UPDATE SET enabled = 1, segment = excluded.segment, instrument_type = excluded.instrument_type, category = excluded.category
  `).run(normalized, derived.segment, derived.instrumentType, derived.category);
  return getInstrument(normalized);
}

export async function addInstrumentWithInitialSync(payload) {
  const instrument = await addInstrument(payload);
  const rangeTo = moment().format('YYYY-MM-DD');
  const rangeFrom = moment().subtract(2, 'months').format('YYYY-MM-DD');
  fetchAndStoreCandles({ symbol: instrument.symbol, resolution: 'D', rangeFrom, rangeTo })
    .catch((error) => {
      void markInstrumentSync(instrument.symbol, 'error', 0);
      console.error(`Initial sync failed for ${instrument.symbol}:`, error.message || error);
    });
  return { ...instrument, sync_status: 'syncing', sync_progress: 0 };
}

export async function listInstruments(category) {
  await seedDefaultInstruments();
  const selectSql = `
    SELECT
      i.*,
      d.current_trend AS latest_trend,
      d.atr_trend AS latest_ha_swing_trend,
      d.consecutive_days AS continuation_days,
      d.stop_loss AS latest_stop_loss,
      d.trade_date AS latest_trend_date,
      COALESCE(c.candle_count, 0) AS candle_count,
      COALESCE(c.daily_candle_count, 0) AS daily_candle_count,
      COALESCE(c.intraday_candle_count, 0) AS intraday_candle_count,
      c.latest_candle_time,
      c.latest_candle_date
    FROM instruments i
    LEFT JOIN daily_trend_analysis d ON d.id = (
      SELECT id FROM daily_trend_analysis
      WHERE symbol = i.symbol
      ORDER BY trade_date DESC
      LIMIT 1
    )
    LEFT JOIN (
      SELECT
        symbol,
        COUNT(*) AS candle_count,
        SUM(CASE WHEN resolution = 'D' THEN 1 ELSE 0 END) AS daily_candle_count,
        SUM(CASE WHEN resolution != 'D' THEN 1 ELSE 0 END) AS intraday_candle_count,
        MAX(candle_time) AS latest_candle_time,
        MAX(trade_date) AS latest_candle_date
      FROM candles
      GROUP BY symbol
    ) c ON c.symbol = i.symbol
    WHERE i.enabled = 1
  `;
  if (category) {
    return getDb().prepare(`${selectSql} AND i.category = ? ORDER BY i.symbol`).all(category);
  }
  return getDb().prepare(`${selectSql} ORDER BY i.category, i.symbol`).all();
}

export async function disableInstrument(symbol) {
  await getDb().prepare('UPDATE instruments SET enabled = 0 WHERE symbol = ?').run(symbol.toUpperCase());
  return listInstruments();
}

export async function upsertUser({ mobile, name, targetLevel = 1 }) {
  await getDb().prepare(`
    INSERT INTO users(mobile, name, target_level, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(mobile) DO UPDATE SET name = excluded.name, target_level = excluded.target_level, updated_at = excluded.updated_at
  `).run(mobile, name || null, normalizeTargetLevel(targetLevel), nowIso());
  const user = await getUserByMobile(mobile);
  await ensureUserStrategyConfig(user.id);
  await ensureDefaultSubscriptions(user.id);
  return user;
}

export async function loginWithMobile({ mobile, name }) {
  if (!mobile) throw new Error('Mobile is required.');
  const role = mobile === '9999999999' ? 'admin' : 'user';
  let user = await getUserByMobile(mobile);
  if (!user) user = await upsertUser({ mobile, name: name || (role === 'admin' ? 'Admin' : null) });
  await ensureUserStrategyConfig(user.id);
  await ensureDefaultSubscriptions(user.id);
  await recordLogin(user.id, mobile, role, 'success', 'Mobile login');
  return { role, user, lastLoginAt: await lastLoginAt(mobile) };
}

export async function listLoginHistory({ mobile, limit = 20 } = {}) {
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

export async function getUserStrategyConfig(mobile) {
  const user = await requireUser(mobile);
  await ensureUserStrategyConfig(user.id);
  return getDb().prepare('SELECT * FROM user_strategy_configs WHERE user_id = ?').get(user.id);
}

export async function updateUserStrategyConfig(mobile, config) {
  const user = await requireUser(mobile);
  await ensureUserStrategyConfig(user.id);
  const current = await getUserStrategyConfig(mobile);
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

  await getDb().prepare(`
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

export async function listUserWatchlist(mobile) {
  const user = await requireUser(mobile);
  return getDb().prepare(`
    SELECT symbol, watchlist_name, created_at
    FROM user_watchlists
    WHERE user_id = ?
    ORDER BY watchlist_name, symbol
  `).all(user.id);
}

export async function addUserWatchlistSymbol(mobile, { symbol, watchlistName = 'default' }) {
  const user = await requireUser(mobile);
  const normalized = symbol.toUpperCase();
  if (!await getInstrument(normalized)) await addInstrument({ symbol: normalized });
  await getDb().prepare(`
    INSERT INTO user_watchlists(user_id, symbol, watchlist_name)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, symbol, watchlist_name) DO NOTHING
  `).run(user.id, normalized, watchlistName);
  return listUserWatchlist(mobile);
}

export async function removeUserWatchlistSymbol(mobile, symbol, watchlistName = 'default') {
  const user = await requireUser(mobile);
  await getDb().prepare(`
    DELETE FROM user_watchlists
    WHERE user_id = ? AND symbol = ? AND watchlist_name = ?
  `).run(user.id, symbol.toUpperCase(), watchlistName);
  return listUserWatchlist(mobile);
}

export async function updateUserBroker(mobile, payload) {
  assertBrokerMutationAllowed();
  const user = await requireUser(mobile);
  const broker = payload.broker?.toLowerCase();
  if (!['fyers', 'upstox'].includes(broker)) throw new Error('Broker must be fyers or upstox.');
  if (payload.id) {
    await getDb().prepare(`
      UPDATE user_brokers
      SET broker = ?, label = ?, api_key = ?, secret_key = ?, redirect_url = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(broker, payload.label || broker, payload.apiKey, payload.secretKey, payload.redirectUrl || null, nowIso(), payload.id, user.id);
    return getUserBrokerById(user.id, payload.id);
  }

  const result = await getDb().prepare(`
    INSERT INTO user_brokers(user_id, broker, label, api_key, secret_key, redirect_url, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(user.id, broker, payload.label || broker, payload.apiKey, payload.secretKey, payload.redirectUrl || null, nowIso());
  return getUserBrokerById(user.id, result.lastInsertRowid);
}

export async function listUserBrokers(mobile) {
  const user = await requireUser(mobile);
  return getDb().prepare(`
    SELECT id, broker, label, api_key, redirect_url, token_expires_at, connected_at, is_connected, is_active, created_at, updated_at
    FROM user_brokers
    WHERE user_id = ?
    ORDER BY is_active DESC, updated_at DESC
  `).all(user.id);
}

export async function setActiveUserBroker(mobile, brokerId) {
  const user = await requireUser(mobile);
  const account = await getUserBrokerById(user.id, brokerId);
  if (!account) throw new Error('Broker account not found.');
  await getDb().prepare('UPDATE user_brokers SET is_active = 0, updated_at = ? WHERE user_id = ?').run(nowIso(), user.id);
  await getDb().prepare('UPDATE user_brokers SET is_active = 1, updated_at = ? WHERE id = ? AND user_id = ?').run(nowIso(), brokerId, user.id);
  return listUserBrokers(mobile);
}

export async function disconnectUserBroker(mobile, brokerId) {
  const user = await requireUser(mobile);
  await getDb().prepare(`
    UPDATE user_brokers
    SET is_connected = 0, access_token = NULL, refresh_token = NULL, auth_code = NULL, token_expires_at = NULL, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(nowIso(), brokerId, user.id);
  return listUserBrokers(mobile);
}

export async function removeUserBroker(mobile, brokerId) {
  const user = await requireUser(mobile);
  await getDb().prepare('DELETE FROM user_brokers WHERE id = ? AND user_id = ?').run(brokerId, user.id);
  return listUserBrokers(mobile);
}

export async function connectUserBroker(mobile, brokerNameOrId) {
  const user = await requireUser(mobile);
  const broker = Number(brokerNameOrId)
    ? await getUserBrokerById(user.id, Number(brokerNameOrId))
    : await getActiveOrNamedUserBroker(user.id, brokerNameOrId?.toLowerCase());
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

export async function connectAdminDataSource() {
  const settings = await getSettings();
  const broker = settings.data_source_broker || 'fyers';
  if (broker !== 'fyers') throw new Error('Only Fyers is supported as data source broker.');
  if (!settings.data_source_api_key || !settings.data_source_secret_key) {
    throw new Error('Save Fyers API key and secret before connecting data source.');
  }
  await syncAdminBrokerSettings(settings);
  const redirectUrl = adminCallbackUrl(settings.data_source_redirect_url, settings.public_api_base);
  const fyers = new FyersAPI.fyersModel();
  fyers.setAppId(settings.data_source_api_key);
  fyers.setRedirectUrl(redirectUrl);
  return { broker: 'fyers', authUrl: await fyers.generateAuthCode(), redirectUrl };
}

export async function completeAdminBrokerCallback({ code }) {
  const settings = await getSettings();
  if (!settings.data_source_api_key || !settings.data_source_secret_key) {
    throw new Error('Admin data source credentials are not saved.');
  }
  const redirectUrl = adminCallbackUrl(settings.data_source_redirect_url, settings.public_api_base);
  const fyers = new FyersAPI.fyersModel();
  fyers.setAppId(settings.data_source_api_key);
  fyers.setRedirectUrl(redirectUrl);
  const data = await fyers.generate_access_token({
    client_id: settings.data_source_api_key,
    secret_key: settings.data_source_secret_key,
    auth_code: code,
  });
  if (data.code && data.code !== 200) throw new Error(data.message || 'Fyers token exchange failed.');
  await upsertAdminBrokerTokens({
    apiKey: settings.data_source_api_key,
    secretKey: settings.data_source_secret_key,
    redirectUrl,
    authCode: code,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
  });
  await updateSettings({
    data_source_status: 'connected',
    data_source_access_token: data.access_token,
    data_source_refresh_token: data.refresh_token || '',
  });
  return { broker: 'fyers', connected: true };
}

export async function completeUserBrokerCallback({ broker, mobile, code, brokerId }) {
  const user = await requireUser(mobile);
  const account = brokerId ? await getUserBrokerById(user.id, Number(brokerId)) : await getActiveOrNamedUserBroker(user.id, broker);
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
    await saveBrokerTokens(account.id, code, data.access_token, data.refresh_token);
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
  await saveBrokerTokens(account.id, code, data.access_token, data.refresh_token);
  return { broker, connected: true };
}

export async function startUserInstance(mobile) {
  assertInstanceWindow();
  const user = await requireUser(mobile);
  const connectedBroker = await getDb().prepare(`
    SELECT * FROM user_brokers WHERE user_id = ? AND is_connected = 1 LIMIT 1
  `).get(user.id);
  if (!connectedBroker) throw new Error('User must connect broker before starting algo.');
  await getDb().prepare(`
    INSERT INTO algo_instances(user_id, status, started_at, updated_at)
    VALUES (?, 'running', ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET status = 'running', started_at = excluded.started_at, stopped_at = NULL, updated_at = excluded.updated_at
  `).run(user.id, nowIso(), nowIso());
  return getUserInstance(mobile);
}

export async function stopUserInstance(mobile) {
  const user = await requireUser(mobile);
  await getDb().prepare(`
    INSERT INTO algo_instances(user_id, status, stopped_at, updated_at)
    VALUES (?, 'stopped', ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET status = 'stopped', stopped_at = excluded.stopped_at, updated_at = excluded.updated_at
  `).run(user.id, nowIso(), nowIso());
  return getUserInstance(mobile);
}

export async function getUserInstance(mobile) {
  const user = await requireUser(mobile);
  return await getDb().prepare('SELECT * FROM algo_instances WHERE user_id = ?').get(user.id) || { user_id: user.id, status: 'stopped' };
}

export async function listStrategiesForUser(mobile) {
  const user = await requireUser(mobile);
  await ensureDefaultSubscriptions(user.id);
  const rows = await getDb().prepare(`
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
  `).all(user.id);
  return rows.map(parseStrategyRow);
}

export async function listUserStrategyHistory(mobile, strategyCode) {
  const user = await requireUser(mobile);
  const watchlist = (await getDb().prepare(`
    SELECT symbol FROM user_watchlists
    WHERE user_id = ?
    ORDER BY symbol
  `).all(user.id)).map((row) => row.symbol);
  const watchlistSet = new Set(watchlist);

  const trades = await getDb().prepare(`
    SELECT strategy, symbol, side, quantity, entry_price, exit_price, exit_reason, status, order_tag, entered_at, exited_at
    FROM orders
    WHERE user_id = ? AND strategy = ?
    ORDER BY entered_at DESC
    LIMIT 100
  `).all(user.id, strategyCode);

  const backtests = (await getDb().prepare(`
    SELECT id, strategy, symbol, range_from, range_to, stats_json, created_at
    FROM backtests
    WHERE strategy = ?
    ORDER BY created_at DESC
    LIMIT 100
  `).all(strategyCode))
    .filter((row) => watchlistSet.size === 0 || watchlistSet.has(row.symbol))
    .map((row) => ({ ...row, stats: safeJson(row.stats_json), stats_json: undefined }));

  return { watchlist, trades, backtests };
}

export async function updateUserStrategySubscription(mobile, strategyCode, payload) {
  const user = await requireUser(mobile);
  const targetLevel = normalizeTargetLevel(payload.targetLevel || 1);
  await getDb().prepare(`
    INSERT INTO user_strategy_subscriptions(user_id, strategy_code, target_level, enabled, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, strategy_code) DO UPDATE SET
      target_level = excluded.target_level,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).run(user.id, strategyCode, targetLevel, toDbBool(payload.enabled ?? true), nowIso());
  return listStrategiesForUser(mobile);
}

export async function listStrategiesAdmin() {
  const rows = await getDb().prepare(`
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
  `).all();
  return rows.map(parseStrategyRow);
}

export async function updateStrategyAdmin(code, payload) {
  const settings = normalizeStrategySettings(payload.settings || payload.settings_json || {});
  await getDb().prepare(`
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
  const instruments = await selectedSymbolsAsync(symbol, category);
  const stored = [];
  for (let index = 0; index < instruments.length; index++) {
    const instrument = instruments[index];
    await markInstrumentSync(instrument.symbol, 'syncing', Math.round(index / instruments.length * 100));
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
    await storeCandles(instrument.symbol, resolution, candles);
    await markInstrumentSync(instrument.symbol, 'idle', 100);
    stored.push({ symbol: instrument.symbol, count: candles.length });
  }
  return stored;
}

export async function calculateAndStoreDailyGannLevels({ symbol, category, tradeDate, sourceKind = 'day_open' }) {
  const instruments = await selectedSymbolsAsync(symbol, category);
  const date = tradeDate || moment().format('YYYY-MM-DD');
  const results = [];
  for (const instrument of instruments) {
    let candles = await getStoredCandles(instrument.symbol, '15', date, date);
    if (candles.length === 0) {
      await fetchAndStoreCandles({ symbol: instrument.symbol, resolution: '15', rangeFrom: date, rangeTo: date });
      candles = await getStoredCandles(instrument.symbol, '15', date, date);
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
  const instruments = await selectedSymbolsAsync(symbol, category);
  const results = [];
  const maxCandleRangePercent = Number((await getSettings()).spike_candle_percent || 1.2);
  for (const instrument of instruments) {
    let candles = await getStoredCandles(instrument.symbol, '15', rangeFrom, rangeTo);
    if (candles.length === 0) {
      await fetchAndStoreCandles({ symbol: instrument.symbol, resolution: '15', rangeFrom, rangeTo });
      candles = await getStoredCandles(instrument.symbol, '15', rangeFrom, rangeTo);
    }
    const result = runIntradayGannStrategy(candles, { targetLevel, useEma, slippagePercent, costPercent, sameCandlePolicy, maxCandleRangePercent });
    storeBacktest('intraday_gann_15m', instrument.symbol, rangeFrom, rangeTo, result);
    results.push({ symbol: instrument.symbol, ...result });
  }
  return results;
}

export async function backtestSwing({ symbol, category, rangeFrom, rangeTo, targetLevel, useEma, slippagePercent, costPercent, sameCandlePolicy }) {
  const instruments = await selectedSymbolsAsync(symbol, category);
  const results = [];
  const maxCandleRangePercent = Number((await getSettings()).spike_candle_percent || 1.2);
  for (const instrument of instruments) {
    const fromWithWarmup = moment(rangeFrom).subtract(35, 'days').format('YYYY-MM-DD');
    let candles = await getStoredCandles(instrument.symbol, 'D', fromWithWarmup, rangeTo);
    if (candles.length === 0) {
      await fetchAndStoreCandles({ symbol: instrument.symbol, resolution: 'D', rangeFrom: fromWithWarmup, rangeTo });
      candles = await getStoredCandles(instrument.symbol, 'D', fromWithWarmup, rangeTo);
    }
    const result = runSwingGannStrategy(candles, { targetLevel, useEma, slippagePercent, costPercent, sameCandlePolicy, maxCandleRangePercent });
    storeBacktest('swing_gann_daily', instrument.symbol, rangeFrom, rangeTo, result);
    results.push({ symbol: instrument.symbol, ...result });
  }
  return results;
}

export async function backtestSwingHaDoji({ symbol, category, rangeFrom, rangeTo, useEma, slippagePercent, costPercent, sameCandlePolicy }) {
  const instruments = await selectedSymbolsAsync(symbol, category);
  const results = [];
  const maxCandleRangePercent = Number((await getSettings()).spike_candle_percent || 1.2);
  for (const instrument of instruments) {
    const fromWithWarmup = moment(rangeFrom).subtract(35, 'days').format('YYYY-MM-DD');
    let candles = await getStoredCandles(instrument.symbol, 'D', fromWithWarmup, rangeTo);
    if (candles.length === 0) {
      await fetchAndStoreCandles({ symbol: instrument.symbol, resolution: 'D', rangeFrom: fromWithWarmup, rangeTo });
      candles = await getStoredCandles(instrument.symbol, 'D', fromWithWarmup, rangeTo);
    }
    const result = runSwingHaDojiGannStrategy(candles, { useEma, slippagePercent, costPercent, sameCandlePolicy, maxCandleRangePercent });
    storeBacktest('swing_ha_doji_gann', instrument.symbol, rangeFrom, rangeTo, result);
    results.push({ symbol: instrument.symbol, ...result });
  }
  return results;
}

export async function backtestIntradayHaDoji({ symbol, category, rangeFrom, rangeTo, useEma, slippagePercent, costPercent, sameCandlePolicy }) {
  const instruments = await selectedSymbolsAsync(symbol, category);
  const results = [];
  const maxCandleRangePercent = Number((await getSettings()).spike_candle_percent || 1.2);
  for (const instrument of instruments) {
    let candles = await getStoredCandles(instrument.symbol, '15', rangeFrom, rangeTo);
    if (candles.length === 0) {
      await fetchAndStoreCandles({ symbol: instrument.symbol, resolution: '15', rangeFrom, rangeTo });
      candles = await getStoredCandles(instrument.symbol, '15', rangeFrom, rangeTo);
    }
    const result = runIntradayHaDojiGannStrategy(candles, { useEma, slippagePercent, costPercent, sameCandlePolicy, maxCandleRangePercent });
    storeBacktest('intraday_ha_doji_gann_15m', instrument.symbol, rangeFrom, rangeTo, result);
    results.push({ symbol: instrument.symbol, ...result });
  }
  return results;
}

export async function backtestStrategyMatrix({ symbol, category = 'stock', rangeFrom, rangeTo, slippagePercent, costPercent, sameCandlePolicy }) {
  const strategies = (await listStrategiesAdmin()).filter((strategy) => strategy.enabled);
  const instruments = await selectedSymbolsAsync(symbol, category);
  const maxCandleRangePercent = Number((await getSettings()).spike_candle_percent || 1.2);
  const byInstrument = [];
  const summary = [];

  for (const instrument of instruments) {
    const needsIntraday = strategies.some((strategy) => strategy.mode === 'intraday');
    const needsDaily = strategies.some((strategy) => strategy.mode === 'swing');
    const intradayCandles = needsIntraday
      ? await ensureBacktestCandles(instrument, '15', rangeFrom, rangeTo)
      : [];
    const dailyCandles = needsDaily
      ? await ensureBacktestCandles(instrument, 'D', moment(rangeFrom).subtract(35, 'days').format('YYYY-MM-DD'), rangeTo)
      : [];
    const strategyGroups = [];

    for (const strategy of strategies) {
      const variants = [];
      const targetLevels = strategy.code.includes('ha_doji')
        ? [2]
        : [1, 2, 3, 4, 5];
      const emaVariants = strategy.settings?.emaFilter === 'both'
        ? [false, true]
        : [Boolean(strategy.settings?.emaFilter)];

      for (const useEma of emaVariants) {
        for (const targetLevel of targetLevels) {
          const candles = strategy.mode === 'intraday' ? intradayCandles : dailyCandles;
          const result = runBacktestVariant(strategy.code, candles, {
            targetLevel,
            useEma,
            slippagePercent,
            costPercent,
            sameCandlePolicy,
            maxCandleRangePercent,
          });
          const variant = {
            variant: `${strategy.code}${useEma ? '_ema' : '_no_ema'}_t${targetLevel}`,
            strategy: strategy.code,
            strategyName: strategy.name,
            symbol: instrument.symbol,
            useEma,
            targetLevel,
            stats: result.stats,
            trades: result.trades,
            dayBlocks: buildTradeDayBlocks(result.trades),
          };
          storeBacktest(strategy.code, instrument.symbol, rangeFrom, rangeTo, result);
          variants.push(variant);
          summary.push({
            variant: variant.variant,
            strategy: strategy.code,
            strategyName: strategy.name,
            symbol: instrument.symbol,
            useEma,
            targetLevel,
            ...result.stats,
          });
        }
      }

      strategyGroups.push({
        code: strategy.code,
        name: strategy.name,
        mode: strategy.mode,
        bestVariant: pickBestVariant(variants),
        targetStats: buildTargetStats(variants),
        variants,
      });
    }

    byInstrument.push({
      symbol: instrument.symbol,
      category: instrument.category,
      candleCounts: {
        intraday: intradayCandles.length,
        daily: dailyCandles.length,
      },
      bestVariant: pickBestVariant(strategyGroups.map((group) => group.bestVariant).filter(Boolean)),
      strategies: strategyGroups,
    });
  }

  return {
    summary: summary.sort((a, b) => Number(b.totalPnl || 0) - Number(a.totalPnl || 0)),
    instruments: byInstrument.sort((a, b) => Number(b.bestVariant?.stats?.totalPnl || 0) - Number(a.bestVariant?.stats?.totalPnl || 0)),
  };
}

export async function listTrades(filters = {}) {
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
  if (filters.category && filters.category !== 'all') {
    conditions.push("COALESCE(i.category, 'stock') = ?");
    params.push(filters.category);
  }
  if (filters.date) {
    conditions.push('DATE(o.created_at) = ?');
    params.push(filters.date);
  }
  if (filters.rangeFrom) {
    conditions.push('DATE(o.created_at) >= ?');
    params.push(filters.rangeFrom);
  }
  if (filters.rangeTo) {
    conditions.push('DATE(o.created_at) <= ?');
    params.push(filters.rangeTo);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return getDb().prepare(`
    SELECT o.*, u.mobile, COALESCE(i.category, 'stock') AS category
    FROM orders o
    JOIN users u ON u.id = o.user_id
    LEFT JOIN instruments i ON i.symbol = o.symbol
    ${where}
    ORDER BY o.created_at DESC
    LIMIT 500
  `).all(...params);
}

export async function getActiveUsers() {
  return getDb().prepare(`
    SELECT u.*, ub.broker, ub.access_token, ub.api_key, ub.secret_key
    FROM users u
    JOIN algo_instances ai ON ai.user_id = u.id AND ai.status = 'running'
    JOIN user_brokers ub ON ub.user_id = u.id AND ub.is_connected = 1
    WHERE u.is_active = 1
  `).all();
}

export async function storeCandles(symbol, resolution, candles) {
  const stmt = getDb().prepare(`
    INSERT INTO candles(symbol, resolution, candle_time, trade_date, open, high, low, close, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(symbol, resolution, candle_time) DO UPDATE SET
      open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close, volume = excluded.volume
  `);
  for (const candle of candles) {
    const tradeDate = moment.unix(candle.time).tz('Asia/Kolkata').format('YYYY-MM-DD');
    await stmt.run(symbol, resolution, candle.time, tradeDate, candle.open, candle.high, candle.low, candle.close, candle.volume || 0);
  }
}

export async function getStoredCandles(symbol, resolution, rangeFrom, rangeTo) {
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

async function ensureBacktestCandles(instrument, resolution, rangeFrom, rangeTo) {
  let candles = await getStoredCandles(instrument.symbol, resolution, rangeFrom, rangeTo);
  if (candles.length === 0) {
    await fetchAndStoreCandles({ symbol: instrument.symbol, resolution, rangeFrom, rangeTo });
    candles = await getStoredCandles(instrument.symbol, resolution, rangeFrom, rangeTo);
  }
  return candles;
}

function runBacktestVariant(strategyCode, candles, options) {
  if (strategyCode === 'intraday_gann_15m') return runIntradayGannStrategy(candles, options);
  if (strategyCode === 'intraday_ha_doji_gann_15m') return runIntradayHaDojiGannStrategy(candles, options);
  if (strategyCode === 'swing_ha_doji_gann') return runSwingHaDojiGannStrategy(candles, options);
  return runSwingGannStrategy(candles, options);
}

function pickBestVariant(variants) {
  return variants.reduce((best, item) => {
    if (!best) return item;
    const pnlDiff = Number(item.stats?.totalPnl || item.totalPnl || 0) - Number(best.stats?.totalPnl || best.totalPnl || 0);
    if (pnlDiff !== 0) return pnlDiff > 0 ? item : best;
    return Number(item.stats?.successRatio || item.successRatio || 0) > Number(best.stats?.successRatio || best.successRatio || 0) ? item : best;
  }, null);
}

function buildTargetStats(variants) {
  const rows = new Map();
  for (const variant of variants) {
    const key = `T${variant.targetLevel}`;
    const current = rows.get(key) || {
      target: key,
      targetLevel: variant.targetLevel,
      runs: 0,
      trades: 0,
      targetHits: 0,
      slHits: 0,
      pnl: 0,
      bestPnl: Number.NEGATIVE_INFINITY,
    };
    current.runs += 1;
    current.trades += Number(variant.stats.totalTrades || 0);
    current.targetHits += Number(variant.stats.targetHits || 0);
    current.slHits += Number(variant.stats.slHits || 0);
    current.pnl = Number((current.pnl + Number(variant.stats.totalPnl || 0)).toFixed(2));
    current.bestPnl = Math.max(current.bestPnl, Number(variant.stats.totalPnl || 0));
    rows.set(key, current);
  }
  return [...rows.values()].map((row) => ({
    ...row,
    bestPnl: Number.isFinite(row.bestPnl) ? row.bestPnl : 0,
    hitRate: row.trades ? Number((row.targetHits / row.trades * 100).toFixed(2)) : 0,
  })).sort((a, b) => a.targetLevel - b.targetLevel);
}

function buildTradeDayBlocks(trades) {
  const byDay = new Map();
  for (const trade of trades || []) {
    const time = trade.exitTime || trade.entryTime;
    const day = typeof time === 'number'
      ? moment.unix(time).format('YYYY-MM-DD')
      : String(time || 'unknown').slice(0, 10);
    const block = byDay.get(day) || {
      day,
      trades: 0,
      pnl: 0,
      targetHits: 0,
      slHits: 0,
      wins: 0,
      losses: 0,
      reasons: [],
    };
    const pnl = Number(trade.pnl || 0);
    block.trades += 1;
    block.pnl = Number((block.pnl + pnl).toFixed(2));
    block.wins += pnl > 0 ? 1 : 0;
    block.losses += pnl <= 0 ? 1 : 0;
    if (String(trade.exitReason || '').includes('TARGET')) block.targetHits += 1;
    if (String(trade.exitReason || '').includes('SL')) block.slHits += 1;
    block.reasons.push(trade.exitReason || 'OPEN');
    byDay.set(day, block);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
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
  throw new Error('selectedSymbols must be called through async strategy helpers.');
}

async function selectedSymbolsAsync(symbol, category) {
  await seedDefaultInstruments();
  if (symbol) return [await getInstrument(symbol.toUpperCase()) || await addInstrument({ symbol })];
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

async function getInstrument(symbol) {
  return getDb().prepare('SELECT * FROM instruments WHERE symbol = ?').get(symbol);
}

async function getUserByMobile(mobile) {
  return getDb().prepare('SELECT * FROM users WHERE mobile = ?').get(mobile);
}

async function requireUser(mobile) {
  const user = await getUserByMobile(mobile);
  if (!user) throw new Error('User not found.');
  return user;
}

async function getUserBroker(userId, broker) {
  return getDb().prepare('SELECT * FROM user_brokers WHERE user_id = ? AND broker = ?').get(userId, broker);
}

async function getUserBrokerById(userId, brokerId) {
  return getDb().prepare('SELECT * FROM user_brokers WHERE user_id = ? AND id = ?').get(userId, brokerId);
}

async function getActiveOrNamedUserBroker(userId, broker) {
  if (Number(broker)) return getUserBrokerById(userId, Number(broker));
  return getDb().prepare(`
    SELECT * FROM user_brokers
    WHERE user_id = ? AND broker = ?
    ORDER BY is_active DESC, updated_at DESC
    LIMIT 1
  `).get(userId, broker);
}

async function ensureUserStrategyConfig(userId) {
  await getDb().prepare(`
    INSERT INTO user_strategy_configs(user_id)
    VALUES (?)
    ON CONFLICT(user_id) DO NOTHING
  `).run(userId);
}

async function ensureDefaultSubscriptions(userId) {
  const strategies = await getDb().prepare('SELECT code FROM strategy_catalog WHERE enabled = 1').all();
  const stmt = getDb().prepare(`
    INSERT INTO user_strategy_subscriptions(user_id, strategy_code, enabled)
    VALUES (?, ?, 0)
    ON CONFLICT(user_id, strategy_code) DO NOTHING
  `);
  for (const strategy of strategies) {
    await stmt.run(userId, strategy.code);
  }
}

async function saveBrokerTokens(accountId, authCode, accessToken, refreshToken) {
  await getDb().prepare(`
    UPDATE user_brokers
    SET auth_code = ?, access_token = ?, refresh_token = ?, token_expires_at = ?, connected_at = ?, is_connected = 1, is_active = 1, updated_at = ?
    WHERE id = ?
  `).run(authCode, accessToken, refreshToken || null, moment().add(20, 'hours').toISOString(), nowIso(), nowIso(), accountId);
  const row = await getDb().prepare('SELECT user_id FROM user_brokers WHERE id = ?').get(accountId);
  if (row) await getDb().prepare('UPDATE user_brokers SET is_active = 0 WHERE user_id = ? AND id != ?').run(row.user_id, accountId);
}

async function syncAdminBrokerSettings(settings = {}) {
  if (!settings.data_source_api_key || !settings.data_source_secret_key) return;
  await getDb().prepare(`
    INSERT INTO admin_brokers(broker, api_key, secret_key, redirect_url, updated_at)
    VALUES ('fyers', ?, ?, ?, ?)
    ON CONFLICT(broker) DO UPDATE SET
      api_key = excluded.api_key,
      secret_key = excluded.secret_key,
      redirect_url = excluded.redirect_url,
      updated_at = excluded.updated_at
  `).run(
    settings.data_source_api_key,
    settings.data_source_secret_key,
    adminCallbackUrl(settings.data_source_redirect_url, settings.public_api_base),
    nowIso(),
  );
}

async function upsertAdminBrokerTokens({ apiKey, secretKey, redirectUrl, authCode, accessToken, refreshToken }) {
  await getDb().prepare(`
    INSERT INTO admin_brokers(
      broker, api_key, secret_key, redirect_url, auth_code, access_token,
      refresh_token, token_expires_at, connected_at, is_connected, updated_at
    )
    VALUES ('fyers', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(broker) DO UPDATE SET
      api_key = excluded.api_key,
      secret_key = excluded.secret_key,
      redirect_url = excluded.redirect_url,
      auth_code = excluded.auth_code,
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      token_expires_at = excluded.token_expires_at,
      connected_at = excluded.connected_at,
      is_connected = 1,
      updated_at = excluded.updated_at
  `).run(
    apiKey,
    secretKey,
    redirectUrl,
    authCode,
    accessToken,
    refreshToken || null,
    moment().add(20, 'hours').toISOString(),
    nowIso(),
    nowIso(),
  );
}

function callbackUrl(configuredUrl, broker, mobile, brokerId) {
  const base = configuredUrl || `http://localhost:8080/api/callback/${broker}`;
  const url = new URL(base);
  url.searchParams.set('mobile', mobile);
  if (brokerId) url.searchParams.set('brokerId', brokerId);
  return url.toString();
}

function adminCallbackUrl(configuredUrl, publicApiBase) {
  const base = configuredUrl || `${publicApiBase || process.env.PUBLIC_API_BASE || 'http://localhost:8080'}/api/callback/fyers`;
  const url = new URL(base);
  url.searchParams.set('admin', '1');
  url.searchParams.set('state', 'admin');
  return url.toString();
}

async function seedDefaultInstruments() {
  const row = await getDb().prepare('SELECT COUNT(*) as count FROM instruments').get();
  const count = row?.count || 0;
  if (count > 0) return;
  for (const symbol of DEFAULT_STOCKS_NAMES) await addInstrument({ symbol, category: 'stock' });
  for (const symbol of ['NIFTY50', 'NIFTYBANK']) await addInstrument({ symbol, category: 'index', instrumentType: '-INDEX' });
  for (const symbol of ['CRUDEOIL', 'GOLD']) await addInstrument({ symbol, category: 'commodity', segment: 'MCX', instrumentType: 'FUT' });
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

async function markInstrumentSync(symbol, status, progress) {
  await getDb().prepare(`
    UPDATE instruments
    SET sync_status = ?, sync_progress = ?, last_sync_at = CASE WHEN ? = 'idle' THEN ? ELSE last_sync_at END
    WHERE symbol = ?
  `).run(status, progress, status, nowIso(), symbol);
}

async function recordLogin(userId, mobile, role, status, message) {
  await getDb().prepare(`
    INSERT INTO login_history(user_id, mobile, role, status, message)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, mobile, role, status, message);
}

async function lastLoginAt(mobile) {
  return (await getDb().prepare(`
    SELECT created_at FROM login_history
    WHERE mobile = ?
    ORDER BY id DESC
    LIMIT 1 OFFSET 1
  `).get(mobile))?.created_at || null;
}

function waitRateLimit(ms = 350) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
