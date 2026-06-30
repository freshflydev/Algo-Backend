import moment from 'moment-timezone';
import schedule from 'node-schedule';
import { calculateAndStoreDailyGannLevels, getSettings, listInstruments } from '../service/platform.service.js';
import { forceCloseIntradayOrders, placeStrategyOrder } from '../service/order.service.js';
import { getDb } from '../db/database.js';
import { calculateEMA, toHeikinAshi } from '../util/Indicators.js';

moment.tz.setDefault('Asia/Kolkata');

let dailyGannJob;
let intradayJob;
let forceCloseJob;
let swingJob;

export function enableAlgoSchedulers() {
  configureDailyGannJob();
  configureIntradayJob();
  configureForceCloseJob();
  configureSwingJob();
}

function configureDailyGannJob() {
  dailyGannJob?.cancel();
  dailyGannJob = schedule.scheduleJob({ hour: 9, minute: 14, tz: 'Asia/Kolkata' }, async () => {
    const settings = await getSettings();
    if (!settings.intraday_enabled && !settings.swing_enabled) return;
    await calculateAndStoreDailyGannLevels({ tradeDate: moment().format('YYYY-MM-DD') });
  });
}

function configureIntradayJob() {
  intradayJob?.cancel();
  intradayJob = schedule.scheduleJob('*/15 * * * *', async () => {
    const settings = await getSettings();
    if (!settings.intraday_enabled) return;
    const now = moment();
    const start = moment({ hour: 9, minute: 15 });
    const end = moment({ hour: 15, minute: 0 });
    if (!now.isBetween(start, end, undefined, '[]')) return;

    const date = now.format('YYYY-MM-DD');
    const instruments = listInstruments();
    for (const instrument of instruments) {
      const level = getDb().prepare('SELECT * FROM gann_levels WHERE symbol = ? AND trade_date = ?').get(instrument.symbol, date);
      if (!level) continue;
      const latest = getDb().prepare(`
        SELECT * FROM candles WHERE symbol = ? AND resolution = '15' AND trade_date = ? ORDER BY candle_time DESC LIMIT 12
      `).all(instrument.symbol, date);
      if (latest.length < 2) continue;
      const ordered = latest.reverse().map(dbCandleToStrategyCandle);
      const current = ordered[ordered.length - 1];
      const previous = ordered[ordered.length - 2];
      await maybeTriggerIntradayOrders(instrument.symbol, current, previous, level, ordered, settings);
    }
  });
}

function configureForceCloseJob() {
  forceCloseJob?.cancel();
  forceCloseJob = schedule.scheduleJob({ hour: 15, minute: 15, tz: 'Asia/Kolkata' }, async () => {
    const settings = await getSettings();
    if (!settings.swing_enabled) {
      await forceCloseIntradayOrders();
    }
  });
}

function configureSwingJob() {
  swingJob?.cancel();
  swingJob = schedule.scheduleJob({ hour: 15, minute: 20, tz: 'Asia/Kolkata' }, async () => {
    const settings = await getSettings();
    if (!settings.swing_enabled) return;
    // Swing execution is daily and long-only. Historical/backtest logic is implemented
    // in strategyEngine; live order trigger is intentionally conservative until the
    // daily candle is stored by the data fetch scheduler.
  });
}

async function maybeTriggerIntradayOrders(symbol, current, previous, level, candles, settings) {
  const activeUsers = getDb().prepare(`
    SELECT u.*, ub.broker, ub.api_key, ub.secret_key, ub.access_token,
      usc.intraday_enabled, usc.intraday_scope, usc.intraday_direction,
      usc.intraday_trade_amount, usc.intraday_leverage, usc.intraday_fresh_trend_only,
      usc.swing_enabled, usc.swing_scope, usc.swing_trade_amount, usc.swing_leverage
    FROM users u
    JOIN algo_instances ai ON ai.user_id = u.id AND ai.status = 'running'
    JOIN user_brokers ub ON ub.user_id = u.id AND ub.is_connected = 1
    LEFT JOIN user_strategy_configs usc ON usc.user_id = u.id
    WHERE u.is_active = 1
  `).all();

  for (const user of activeUsers) {
    if (!user.intraday_enabled) continue;
    if (!isSymbolInUserScope(user, symbol)) continue;
    const existing = getDb().prepare(`
      SELECT id FROM orders
      WHERE user_id = ? AND symbol = ? AND status IN ('open', 'placing', 'dry_run_open')
      LIMIT 1
    `).get(user.id, symbol);
    if (existing) continue;

    const targetLevel = user.target_level || 1;
    if (isSpikeCandle(current, Number(settings.spike_candle_percent || 1.2))) continue;
    let placed = false;
    if (
      ['BUY', 'BOTH'].includes(user.intraday_direction || 'BOTH') &&
      current.close > previous.high &&
      current.close >= level.buy
    ) {
      await placeStrategyOrder({
        user,
        brokerAccount: user,
        strategy: 'intraday_gann_15m',
        symbol,
        side: 'BUY',
        entryPrice: current.close,
        stopLoss: level.buy_sl,
        targetPrice: level[`buy_target${targetLevel}`],
        targetLevel,
        candle: current,
      });
      placed = true;
    }

    if (!placed && (
      ['SELL', 'BOTH'].includes(user.intraday_direction || 'BOTH') &&
      current.close < previous.low &&
      current.close <= level.sell
    )) {
      await placeStrategyOrder({
        user,
        brokerAccount: user,
        strategy: 'intraday_gann_15m',
        symbol,
        side: 'SELL',
        entryPrice: current.close,
        stopLoss: level.sell_sl,
        targetPrice: level[`sell_target${targetLevel}`],
        targetLevel,
        candle: current,
      });
      placed = true;
    }

    if (!placed && settings.intraday_ha_doji_enabled) {
      const signal = getHaDojiLiveSignal(candles, level, Boolean(settings.intraday_ha_doji_ema_filter_enabled));
      if (signal && ['BOTH', signal.side].includes(user.intraday_direction || 'BOTH')) {
        await placeStrategyOrder({
          user,
          brokerAccount: user,
          strategy: 'intraday_ha_doji_gann_15m',
          symbol,
          side: signal.side,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          targetPrice: signal.targetPrice,
          targetLevel: 2,
          candle: current,
        });
      }
    }
  }
}

function isSymbolInUserScope(user, symbol) {
  if ((user.intraday_scope || 'WATCHLIST') === 'AUTOMATED') return true;
  return Boolean(getDb().prepare(`
    SELECT id FROM user_watchlists
    WHERE user_id = ? AND symbol = ?
    LIMIT 1
  `).get(user.id, symbol));
}

function getHaDojiLiveSignal(candles, level, useEma) {
  if (candles.length < 3) return null;
  const ha = toHeikinAshi(candles);
  const ema = calculateEMA(candles.map((candle) => candle.close), 21);
  const currentIndex = candles.length - 1;
  const current = candles[currentIndex];

  for (let i = currentIndex - 1; i >= Math.max(0, currentIndex - 8); i--) {
    const doji = ha[i];
    if (!isHaDoji(doji)) continue;

    const buySetup = doji.close >= level.buy;
    const sellSetup = doji.close <= level.sell;
    const between = candles.slice(i + 1, currentIndex);
    const buyInvalid = between.some((candle) => candle.low < doji.low) || current.low < doji.low;
    const sellInvalid = between.some((candle) => candle.high > doji.high) || current.high > doji.high;

    if (buySetup && !buyInvalid && ha[currentIndex].close > doji.high && (!useEma || current.close > ema[currentIndex])) {
      const risk = current.close - doji.low;
      if (risk <= 0) return null;
      return { side: 'BUY', entryPrice: current.close, stopLoss: doji.low, targetPrice: current.close + risk * 2 };
    }

    if (sellSetup && !sellInvalid && ha[currentIndex].close < doji.low && (!useEma || current.close < ema[currentIndex])) {
      const risk = doji.high - current.close;
      if (risk <= 0) return null;
      return { side: 'SELL', entryPrice: current.close, stopLoss: doji.high, targetPrice: current.close - risk * 2 };
    }
  }
  return null;
}

function isHaDoji(candle) {
  const range = candle.high - candle.low;
  return range > 0 && Math.abs(candle.open - candle.close) / range <= 0.1;
}

function isSpikeCandle(candle, maxRangePercent) {
  if (!candle?.open) return false;
  const rangePercent = Math.abs(candle.high - candle.low) / candle.open * 100;
  return rangePercent > maxRangePercent;
}

function dbCandleToStrategyCandle(row) {
  return {
    time: row.candle_time,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume || 0,
  };
}
