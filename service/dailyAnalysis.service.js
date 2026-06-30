import moment from 'moment-timezone';
import { getDb, nowIso } from '../db/database.js';
import { toHeikinAshi } from '../util/Indicators.js';
import { calculateGannLevels } from '../util/GannLevels.js';

moment.tz.setDefault('Asia/Kolkata');

export async function rebuildDailyAnalysis({ symbol, rangeFrom, rangeTo } = {}) {
  const symbols = symbol ? [symbol.toUpperCase()] : (await getDb().prepare(`
    SELECT DISTINCT symbol FROM candles WHERE resolution IN ('D', '1D')
  `).all()).map((row) => row.symbol);

  const output = [];
  for (const item of symbols) {
    const candles = await getDailyCandles(item, rangeFrom, rangeTo);
    const rows = analyzeDailyCandles(item, candles);
    for (const row of rows) await upsertAnalysisRow(row);
    output.push({ symbol: item, count: rows.length, latest: rows[rows.length - 1] || null });
  }
  return output;
}

export async function listDailyAnalysis(filters = {}) {
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

export async function listInstrumentTrend(symbol, limit = 30) {
  const visibleLimit = Math.min(Number(limit || 30), 90);
  const warmupLimit = visibleLimit * 2;
  const candles = await getLatestDailyCandles(symbol.toUpperCase(), warmupLimit);
  const analyzed = analyzeDailyCandles(symbol.toUpperCase(), candles);
  const visible = analyzed.slice(-visibleLimit).reverse();
  return {
    symbol: symbol.toUpperCase(),
    requiredWarmupDays: visibleLimit,
    loadedCandles: candles.length,
    normal: visible.map((row) => trendRow(row, 'normal')).reverse(),
    heikinAshi: visible.map((row) => trendRow(row, 'ha')).reverse(),
    latestFirst: {
      normal: visible.map((row) => trendRow(row, 'normal')),
      heikinAshi: visible.map((row) => trendRow(row, 'ha')),
    },
  };
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
    const normalTrend = calculateSingleTrend({
      close: candle.close,
      high: candle.high,
      low: candle.low,
      buy: normalGann.buy,
      sell: normalGann.sell,
      previous: previous?.normal,
    });
    const haTrend = calculateSingleTrend({
      close: haCandle.close,
      high: haCandle.high,
      low: haCandle.low,
      buy: haGann.buy,
      sell: haGann.sell,
      previous: previous?.ha,
    });
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
      currentTrend: combinedTrend(normalTrend.currentTrend, haTrend.currentTrend),
      atrTrend: haTrend.atrTrend,
      consecutiveDays: haTrend.consecutiveDays,
      stopLoss: haTrend.stopLoss,
      slHit: haTrend.stopLoss ? candle.low <= haTrend.stopLoss && candle.high >= haTrend.stopLoss : false,
      dayChangeValue: Number(change.toFixed(2)),
      dayChangePercent: Number(changePercent.toFixed(2)),
      normal: normalTrend,
      ha: haTrend,
      raw: { normalGann, haGann, normalTrend, haTrend },
    };

    rows.push(row);
    previous = row;
  }
  return rows;
}

async function getDailyCandles(symbol, rangeFrom, rangeTo) {
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

async function getLatestDailyCandles(symbol, limit) {
  const rows = await getDb().prepare(`
    SELECT candle_time as time, open, high, low, close, volume
    FROM candles
    WHERE symbol = ? AND resolution IN ('D', '1D')
    ORDER BY candle_time DESC
    LIMIT ?
  `).all(symbol, limit);
  return rows.reverse();
}

function calculateSingleTrend({ close, high, low, buy, sell, previous }) {
  let currentTrend = 'NEUTRAL';
  if (close > buy) {
    currentTrend = 'BULLISH';
  } else if (close < sell) {
    currentTrend = 'BEARISH';
  }

  const consecutiveDays = previous?.currentTrend === currentTrend
    ? previous.consecutiveDays + 1
    : 1;

  let stopLoss = null;
  if (previous) {
    if (currentTrend.includes('BULLISH')) {
      stopLoss = previous.sell || sell;
    } else if (currentTrend.includes('BEARISH')) {
      stopLoss = previous.buy || buy;
    } else {
      stopLoss = previous.stopLoss;
    }
  }

  return {
    currentTrend,
    atrTrend: currentTrend === 'NEUTRAL' ? previous?.atrTrend || previous?.currentTrend || 'NEUTRAL' : currentTrend,
    consecutiveDays,
    stopLoss,
    slHit: stopLoss ? low <= stopLoss && high >= stopLoss : false,
    buy,
    sell,
  };
}

function combinedTrend(normalTrend, haTrend) {
  if (normalTrend.includes('BULLISH') && haTrend.includes('BULLISH')) return 'EXTREME_BULLISH';
  if (normalTrend.includes('BEARISH') && haTrend.includes('BEARISH')) return 'EXTREME_BEARISH';
  if (normalTrend.includes('BULLISH') || haTrend.includes('BULLISH')) return 'MILD_BULLISH';
  if (normalTrend.includes('BEARISH') || haTrend.includes('BEARISH')) return 'MILD_BEARISH';
  return 'NEUTRAL';
}

async function upsertAnalysisRow(row) {
  await getDb().prepare(`
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

function trendRow(row, mode) {
  const isHa = mode === 'ha';
  const trend = isHa ? row.ha.currentTrend : row.normal.currentTrend;
  const gann = isHa ? row.raw.haGann : row.raw.normalGann;
  return {
    symbol: row.symbol,
    mode,
    trade_date: row.tradeDate,
    trend,
    atr_trend: isHa ? row.ha.atrTrend : row.normal.atrTrend,
    continuation_days: isHa ? row.ha.consecutiveDays : row.normal.consecutiveDays,
    open: isHa ? row.haOpen : row.open,
    high: isHa ? row.haHigh : row.high,
    low: isHa ? row.haLow : row.low,
    close: isHa ? row.haClose : row.close,
    source_close: row.close,
    day_change_percent: row.dayChangePercent,
    stop_loss: isHa ? row.ha.stopLoss : row.normal.stopLoss,
    sl_hit: isHa ? row.ha.slHit : row.normal.slHit,
    gann_buy: isHa ? row.haGannBuy : row.gannBuy,
    gann_sell: isHa ? row.haGannSell : row.gannSell,
    target_hits: targetHits({ high: isHa ? row.haHigh : row.high, low: isHa ? row.haLow : row.low, trend }, gann),
  };
}

function targetHits(row, gann) {
  const side = String(row.trend || '').includes('BEARISH') ? 'sell' : 'buy';
  const targets = side === 'buy' ? gann.buyTargets || [] : gann.sellTargets || [];
  return [1, 2, 3, 4, 5].map((level) => {
    const target = targets[level - 1];
    const hit = target ? side === 'buy' ? row.high >= target : row.low <= target : false;
    return { level, target, hit };
  });
}

function safeJson(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}
