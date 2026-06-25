import moment from 'moment-timezone';
import { getDb, nowIso } from '../db/database.js';
import { toHeikinAshi } from '../util/Indicators.js';
import { calculateGannLevels } from '../util/GannLevels.js';

moment.tz.setDefault('Asia/Kolkata');

export function rebuildDailyAnalysis({ symbol, rangeFrom, rangeTo } = {}) {
  const symbols = symbol ? [symbol.toUpperCase()] : getDb().prepare(`
    SELECT DISTINCT symbol FROM candles WHERE resolution IN ('D', '1D')
  `).all().map((row) => row.symbol);

  const output = [];
  for (const item of symbols) {
    const candles = getDailyCandles(item, rangeFrom, rangeTo);
    const rows = analyzeDailyCandles(item, candles);
    rows.forEach(upsertAnalysisRow);
    output.push({ symbol: item, count: rows.length, latest: rows[rows.length - 1] || null });
  }
  return output;
}

export function listDailyAnalysis(filters = {}) {
  const conditions = [];
  const params = [];
  if (filters.symbol) {
    conditions.push('symbol = ?');
    params.push(filters.symbol.toUpperCase());
  }
  if (filters.trend) {
    conditions.push('current_trend LIKE ?');
    params.push(`%${filters.trend.toUpperCase()}%`);
  }
  if (filters.from) {
    conditions.push('trade_date >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push('trade_date <= ?');
    params.push(filters.to);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Number(filters.limit || 250), 1000);
  return getDb().prepare(`
    SELECT * FROM daily_trend_analysis
    ${where}
    ORDER BY trade_date DESC, symbol ASC
    LIMIT ?
  `).all(...params, limit);
}

export function listInstrumentTrend(symbol, limit = 45) {
  const rows = listDailyAnalysis({ symbol, limit });
  return rows.map((row) => {
    const raw = safeJson(row.raw_json);
    const normalGann = raw.normalGann || {};
    const haGann = raw.haGann || {};
    return {
      symbol: row.symbol,
      trade_date: row.trade_date,
      trend: row.current_trend,
      atr_trend: row.atr_trend,
      continuation_days: row.consecutive_days,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      ha_open: row.ha_open,
      ha_close: row.ha_close,
      day_change_percent: row.day_change_percent,
      stop_loss: row.stop_loss,
      sl_hit: row.sl_hit,
      gann_buy: row.gann_buy,
      gann_sell: row.gann_sell,
      ha_gann_buy: row.ha_gann_buy,
      ha_gann_sell: row.ha_gann_sell,
      target_hits: targetHits(row, normalGann, haGann),
    };
  });
}

export function analyzeDailyCandles(symbol, candles) {
  if (!candles.length) return [];
  const ha = toHeikinAshi(candles);
  const rows = [];
  let previous = null;

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const haCandle = ha[i];
    const normalGann = calculateGannLevels(candle.open);
    const haGann = calculateGannLevels(haCandle.open);
    const trend = calculateTrend(candle, normalGann, haGann, previous);
    const change = previous
      ? candle.close - previous.close
      : 0;
    const changePercent = previous && previous.close
      ? (change / previous.close) * 100
      : 0;

    const row = {
      symbol,
      tradeDate: moment.unix(candle.time).format('YYYY-MM-DD'),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume || 0,
      haOpen: haCandle.open,
      haHigh: haCandle.high,
      haLow: haCandle.low,
      haClose: haCandle.close,
      gannBuy: normalGann.buy,
      gannSell: normalGann.sell,
      haGannBuy: haGann.buy,
      haGannSell: haGann.sell,
      currentTrend: trend.currentTrend,
      atrTrend: trend.atrTrend,
      consecutiveDays: trend.consecutiveDays,
      stopLoss: trend.stopLoss,
      slHit: trend.stopLoss ? candle.low <= trend.stopLoss && candle.high >= trend.stopLoss : false,
      dayChangeValue: Number(change.toFixed(2)),
      dayChangePercent: Number(changePercent.toFixed(2)),
      raw: { normalGann, haGann },
    };

    rows.push(row);
    previous = row;
  }
  return rows;
}

function getDailyCandles(symbol, rangeFrom, rangeTo) {
  const conditions = [`symbol = ?`, `resolution IN ('D', '1D')`];
  const params = [symbol];
  if (rangeFrom) {
    conditions.push('trade_date >= ?');
    params.push(rangeFrom);
  }
  if (rangeTo) {
    conditions.push('trade_date <= ?');
    params.push(rangeTo);
  }
  return getDb().prepare(`
    SELECT candle_time as time, open, high, low, close, volume
    FROM candles
    WHERE ${conditions.join(' AND ')}
    ORDER BY candle_time ASC
  `).all(...params);
}

function calculateTrend(candle, normalGann, haGann, previous) {
  let currentTrend = 'NEUTRAL';
  if (candle.close > normalGann.buy && candle.close > haGann.buy) {
    currentTrend = 'EXTREME_BULLISH';
  } else if (candle.close > normalGann.buy) {
    currentTrend = 'MILD_BULLISH';
  } else if (candle.close < normalGann.sell && candle.close < haGann.sell) {
    currentTrend = 'EXTREME_BEARISH';
  } else if (candle.close < normalGann.sell) {
    currentTrend = 'MILD_BEARISH';
  }

  const consecutiveDays = previous?.currentTrend === currentTrend
    ? previous.consecutiveDays + 1
    : 1;

  let stopLoss = null;
  if (previous) {
    if (currentTrend.includes('BULLISH')) {
      stopLoss = previous.haGannSell || normalGann.sell;
    } else if (currentTrend.includes('BEARISH')) {
      stopLoss = previous.haGannBuy || normalGann.buy;
    } else {
      stopLoss = previous.stopLoss;
    }
  }

  return {
    currentTrend,
    atrTrend: currentTrend === 'NEUTRAL' ? previous?.atrTrend || previous?.currentTrend || 'NEUTRAL' : currentTrend,
    consecutiveDays,
    stopLoss,
  };
}

function upsertAnalysisRow(row) {
  getDb().prepare(`
    INSERT INTO daily_trend_analysis(
      symbol, trade_date, open, high, low, close, volume,
      ha_open, ha_high, ha_low, ha_close,
      gann_buy, gann_sell, ha_gann_buy, ha_gann_sell,
      current_trend, atr_trend, consecutive_days, stop_loss, sl_hit,
      day_change_value, day_change_percent, raw_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(symbol, trade_date) DO UPDATE SET
      open = excluded.open,
      high = excluded.high,
      low = excluded.low,
      close = excluded.close,
      volume = excluded.volume,
      ha_open = excluded.ha_open,
      ha_high = excluded.ha_high,
      ha_low = excluded.ha_low,
      ha_close = excluded.ha_close,
      gann_buy = excluded.gann_buy,
      gann_sell = excluded.gann_sell,
      ha_gann_buy = excluded.ha_gann_buy,
      ha_gann_sell = excluded.ha_gann_sell,
      current_trend = excluded.current_trend,
      atr_trend = excluded.atr_trend,
      consecutive_days = excluded.consecutive_days,
      stop_loss = excluded.stop_loss,
      sl_hit = excluded.sl_hit,
      day_change_value = excluded.day_change_value,
      day_change_percent = excluded.day_change_percent,
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at
  `).run(
    row.symbol, row.tradeDate, row.open, row.high, row.low, row.close, row.volume,
    row.haOpen, row.haHigh, row.haLow, row.haClose,
    row.gannBuy, row.gannSell, row.haGannBuy, row.haGannSell,
    row.currentTrend, row.atrTrend, row.consecutiveDays, row.stopLoss, row.slHit ? 1 : 0,
    row.dayChangeValue, row.dayChangePercent, JSON.stringify(row.raw), nowIso(),
  );
}

function targetHits(row, normalGann, haGann) {
  const side = String(row.current_trend || '').includes('BEARISH') ? 'sell' : 'buy';
  const normalTargets = side === 'buy' ? normalGann.buyTargets || [] : normalGann.sellTargets || [];
  const haTargets = side === 'buy' ? haGann.buyTargets || [] : haGann.sellTargets || [];
  return [1, 2, 3, 4, 5].map((level) => {
    const normalTarget = normalTargets[level - 1];
    const haTarget = haTargets[level - 1];
    const hitNormal = normalTarget ? side === 'buy' ? row.high >= normalTarget : row.low <= normalTarget : false;
    const hitHa = haTarget ? side === 'buy' ? row.high >= haTarget : row.low <= haTarget : false;
    return { level, normalTarget, haTarget, hitNormal, hitHa };
  });
}

function safeJson(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}
