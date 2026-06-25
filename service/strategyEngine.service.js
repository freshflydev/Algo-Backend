import { calculateEMA, toHeikinAshi } from '../util/Indicators.js';
import { calculateGannLevels } from '../util/GannLevels.js';

export function runIntradayGannStrategy(candles, options = {}) {
  const targetLevel = normalizeTargetLevel(options.targetLevel);
  const useEma = Boolean(options.useEma);
  const model = getBacktestModel(options);
  const ema = calculateEMA(candles.map((c) => c.close), 21);
  const trades = [];
  let active = null;
  let levels = null;

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const prev = candles[i - 1];
    if (!levels) {
      levels = calculateGannLevels(candles[0].open);
    }

    const buyAllowed = !useEma || candle.close > ema[i];
    const sellAllowed = !useEma || candle.close < ema[i];

    // Once a trade is active, this backtest only manages exits.
    // New entries are blocked until the active position closes.
    if (active) {
      const exit = intradayExit(active, candle, model);
      if (exit) {
        trades.push({ ...active, ...exit });
        active = null;
      }
      continue;
    }

    // Intraday buy: 15m close breaks previous candle high and is above daily GANN buy.
    if (!prev) continue;
    if (isSpikeCandle(candle, model.maxCandleRangePercent)) continue;
    if (candle.close > prev.high && candle.close >= levels.buy && buyAllowed) {
      const entryPrice = applySlippage(candle.close, 'BUY', 'entry', model);
      const targetPrice = applySlippage(levels.buyTargets[targetLevel - 1], 'BUY', 'exit', model);
      if (targetPrice <= entryPrice) continue;
      active = {
        strategy: 'intraday_gann_15m',
        side: 'BUY',
        entryTime: candle.time,
        entryPrice,
        stopLoss: levels.buySl || prev.low,
        targetPrice,
        targetLevel,
      };
    // Intraday sell: 15m close breaks previous candle low and is below daily GANN sell.
    } else if (candle.close < prev.low && candle.close <= levels.sell && sellAllowed) {
      const entryPrice = applySlippage(candle.close, 'SELL', 'entry', model);
      const targetPrice = applySlippage(levels.sellTargets[targetLevel - 1], 'SELL', 'exit', model);
      if (targetPrice >= entryPrice) continue;
      active = {
        strategy: 'intraday_gann_15m',
        side: 'SELL',
        entryTime: candle.time,
        entryPrice,
        stopLoss: levels.sellSl || prev.high,
        targetPrice,
        targetLevel,
      };
    }
  }

  if (active) {
    const last = candles[candles.length - 1];
    trades.push({
      ...active,
      exitTime: last.time,
      exitPrice: last.close,
      exitReason: 'FORCE_CLOSE',
      pnl: netPnl(active, last.close, model),
    });
  }

  return {
    strategy: 'intraday_gann_15m',
    targetLevel,
    useEma,
    sourceOpen: candles[0]?.open,
    levels,
    trades,
    stats: summarizeTrades(trades),
    assumptions: model,
  };
}

export function runSwingGannStrategy(dailyCandles, options = {}) {
  const targetLevel = normalizeTargetLevel(options.targetLevel);
  const model = getBacktestModel(options);
  const useEma = options.useEma !== false;
  const haCandles = toHeikinAshi(dailyCandles);
  const ema = calculateEMA(dailyCandles.map((c) => c.close), 21);
  const trades = [];
  let active = null;

  for (let i = 30; i < haCandles.length; i++) {
    const candle = dailyCandles[i];
    const ha = haCandles[i];
    const previousHa = haCandles[i - 1];
    const todayLevels = calculateGannLevels(ha.open);
    const previousLevels = calculateGannLevels(previousHa.open);

    // Swing is long-only. The trailing SL is recalculated from the previous day's
    // Heikin Ashi GANN sell level, matching the manual rule you described.
    if (active) {
      const trailingSl = previousLevels.sell;
      const hitTarget = candle.high >= active.targetPrice;
      const hitSl = candle.low <= trailingSl;
      if (hitTarget || hitSl) {
        const exitPrice = hitTarget ? active.targetPrice : trailingSl;
        trades.push({
          ...active,
          exitTime: candle.time,
          exitPrice,
          exitReason: hitTarget ? `TARGET_${targetLevel}` : 'PREVIOUS_DAY_GANN_SELL_SL',
          pnl: netPnl(active, exitPrice, model),
        });
        active = null;
      }
      continue;
    }

    // Swing entry: daily candle crosses HA-open GANN buy and passes optional 21 EMA.
    const crossedBuy = candle.close > todayLevels.buy && candle.high >= todayLevels.buy;
    const emaOk = !useEma || candle.close > ema[i];
    if (crossedBuy && emaOk && !isSpikeCandle(candle, model.maxCandleRangePercent)) {
      const entryPrice = applySlippage(Math.max(todayLevels.buy, candle.open), 'BUY', 'entry', model);
      const targetPrice = applySlippage(todayLevels.buyTargets[targetLevel - 1], 'BUY', 'exit', model);
      if (targetPrice <= entryPrice) continue;
      active = {
        strategy: 'swing_gann_daily',
        side: 'BUY',
        entryTime: candle.time,
        entryPrice,
        stopLoss: todayLevels.sell,
        targetPrice,
        targetLevel,
      };
    }
  }

  if (active) {
    const last = dailyCandles[dailyCandles.length - 1];
    trades.push({
      ...active,
      exitTime: last.time,
      exitPrice: last.close,
      exitReason: 'OPEN_AT_RANGE_END',
      pnl: netPnl(active, last.close, model),
    });
  }

  return {
    strategy: 'swing_gann_daily',
    targetLevel,
    useEma,
    trades,
    stats: summarizeTrades(trades),
    assumptions: model,
  };
}

export function runSwingHaDojiGannStrategy(dailyCandles, options = {}) {
  const model = getBacktestModel(options);
  const useEma = options.useEma !== false;
  const haCandles = toHeikinAshi(dailyCandles);
  const ema = calculateEMA(dailyCandles.map((c) => c.close), 21);
  const trades = [];
  let active = null;

  for (let i = 30; i < haCandles.length; i++) {
    const candle = dailyCandles[i];
    const ha = haCandles[i];
    const previousHa = haCandles[i - 1];
    const levels = calculateGannLevels(ha.open);
    const previousLevels = calculateGannLevels(previousHa.open);

    if (active) {
      const trailingSl = previousLevels.sell;
      const hitTarget = candle.high >= active.targetPrice;
      const hitSl = candle.low <= trailingSl;
      if (hitTarget || hitSl) {
        const exitPrice = hitTarget ? active.targetPrice : trailingSl;
        trades.push({
          ...active,
          exitTime: candle.time,
          exitPrice,
          exitReason: hitTarget ? 'TARGET_DOJI_RISK_2R' : 'PREVIOUS_DAY_GANN_SELL_SL',
          pnl: netPnl(active, exitPrice, model),
        });
        active = null;
      }
      continue;
    }

    const previousWasDoji = isHaDoji(previousHa);
    const breaksDojiHigh = candle.high > previousHa.high && candle.close > previousHa.high;
    const aboveGann = candle.close > levels.buy;
    const emaOk = !useEma || candle.close > ema[i];
    if (previousWasDoji && breaksDojiHigh && aboveGann && emaOk && !isSpikeCandle(candle, model.maxCandleRangePercent)) {
      const entryPrice = applySlippage(Math.max(candle.open, previousHa.high), 'BUY', 'entry', model);
      const stopLoss = previousHa.low;
      const risk = Math.abs(entryPrice - stopLoss);
      if (risk <= 0) continue;
      active = {
        strategy: 'swing_ha_doji_gann',
        side: 'BUY',
        entryTime: candle.time,
        entryPrice,
        stopLoss,
        targetPrice: applySlippage(entryPrice + risk * 2, 'BUY', 'exit', model),
        targetLevel: 2,
        dojiTime: previousHa.time,
      };
    }
  }

  if (active) {
    const last = dailyCandles[dailyCandles.length - 1];
    trades.push({
      ...active,
      exitTime: last.time,
      exitPrice: last.close,
      exitReason: 'OPEN_AT_RANGE_END',
      pnl: netPnl(active, last.close, model),
    });
  }

  return {
    strategy: 'swing_ha_doji_gann',
    useEma,
    trades,
    stats: summarizeTrades(trades),
    assumptions: model,
  };
}

export function runIntradayHaDojiGannStrategy(candles, options = {}) {
  const useEma = Boolean(options.useEma);
  const model = getBacktestModel(options);
  const haCandles = toHeikinAshi(candles);
  const ema = calculateEMA(candles.map((c) => c.close), 21);
  const levels = candles.length ? calculateGannLevels(candles[0].open) : null;
  const trades = [];
  let active = null;
  let pendingDoji = null;

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const ha = haCandles[i];

    if (active) {
      const exit = intradayExit(active, candle, model);
      if (exit) {
        trades.push({ ...active, ...exit });
        active = null;
      }
      continue;
    }

    if (pendingDoji && i > pendingDoji.index) {
      const invalidatedBuy = pendingDoji.side === 'BUY' && candle.low < pendingDoji.low;
      const invalidatedSell = pendingDoji.side === 'SELL' && candle.high > pendingDoji.high;
      if (invalidatedBuy || invalidatedSell) {
        pendingDoji = null;
      } else if (
        pendingDoji.side === 'BUY' &&
        ha.close > pendingDoji.high &&
        (!useEma || candle.close > ema[i]) &&
        !isSpikeCandle(candle, model.maxCandleRangePercent)
      ) {
        active = createDojiTrade('BUY', candle, pendingDoji, model);
        pendingDoji = null;
      } else if (
        pendingDoji.side === 'SELL' &&
        ha.close < pendingDoji.low &&
        (!useEma || candle.close < ema[i]) &&
        !isSpikeCandle(candle, model.maxCandleRangePercent)
      ) {
        active = createDojiTrade('SELL', candle, pendingDoji, model);
        pendingDoji = null;
      }
    }

    if (!active && !pendingDoji && isHaDoji(ha)) {
      if (ha.close >= levels.buy) {
        pendingDoji = { side: 'BUY', high: ha.high, low: ha.low, time: candle.time, index: i };
      } else if (ha.close <= levels.sell) {
        pendingDoji = { side: 'SELL', high: ha.high, low: ha.low, time: candle.time, index: i };
      }
    }
  }

  if (active) {
    const last = candles[candles.length - 1];
    trades.push({
      ...active,
      exitTime: last.time,
      exitPrice: last.close,
      exitReason: 'FORCE_CLOSE',
      pnl: netPnl(active, last.close, model),
    });
  }

  return {
    strategy: 'intraday_ha_doji_gann_15m',
    useEma,
    sourceOpen: candles[0]?.open,
    levels,
    trades,
    stats: summarizeTrades(trades),
    assumptions: model,
  };
}

function intradayExit(active, candle, model) {
  if (active.side === 'BUY') {
    const hitTarget = candle.high >= active.targetPrice;
    const hitSl = candle.low <= active.stopLoss;
    if (hitTarget && hitSl && model.sameCandlePolicy === 'SL_FIRST') {
      return {
        exitTime: candle.time,
        exitPrice: active.stopLoss,
        exitReason: 'SL_SAME_CANDLE',
        pnl: netPnl(active, active.stopLoss, model),
      };
    }
    if (hitTarget) {
      return {
        exitTime: candle.time,
        exitPrice: active.targetPrice,
        exitReason: `TARGET_${active.targetLevel}`,
        pnl: netPnl(active, active.targetPrice, model),
      };
    }
    if (hitSl) {
      return {
        exitTime: candle.time,
        exitPrice: active.stopLoss,
        exitReason: 'SL',
        pnl: netPnl(active, active.stopLoss, model),
      };
    }
    return null;
  }

  const hitTarget = candle.low <= active.targetPrice;
  const hitSl = candle.high >= active.stopLoss;
  if (hitTarget && hitSl && model.sameCandlePolicy === 'SL_FIRST') {
    return {
      exitTime: candle.time,
      exitPrice: active.stopLoss,
      exitReason: 'SL_SAME_CANDLE',
      pnl: netPnl(active, active.stopLoss, model),
    };
  }
  if (hitTarget) {
    return {
      exitTime: candle.time,
      exitPrice: active.targetPrice,
      exitReason: `TARGET_${active.targetLevel}`,
      pnl: netPnl(active, active.targetPrice, model),
    };
  }
  if (hitSl) {
    return {
      exitTime: candle.time,
      exitPrice: active.stopLoss,
      exitReason: 'SL',
      pnl: netPnl(active, active.stopLoss, model),
    };
  }
  return null;
}

function createDojiTrade(side, candle, doji, model) {
  const entryPrice = applySlippage(candle.close, side, 'entry', model);
  const stopLoss = side === 'BUY' ? doji.low : doji.high;
  const risk = Math.abs(entryPrice - stopLoss);
  const targetPrice = side === 'BUY'
    ? applySlippage(entryPrice + risk * 2, side, 'exit', model)
    : applySlippage(entryPrice - risk * 2, side, 'exit', model);
  return {
    strategy: 'intraday_ha_doji_gann_15m',
    side,
    entryTime: candle.time,
    entryPrice,
    stopLoss,
    targetPrice,
    targetLevel: 2,
    dojiTime: doji.time,
  };
}

function isHaDoji(candle) {
  const range = candle.high - candle.low;
  if (range <= 0) return false;
  return Math.abs(candle.open - candle.close) / range <= 0.1;
}

function isSpikeCandle(candle, maxRangePercent) {
  if (!candle?.open) return false;
  const rangePercent = Math.abs(candle.high - candle.low) / candle.open * 100;
  return rangePercent > maxRangePercent;
}

function pnl(trade, exitPrice) {
  return trade.side === 'BUY'
    ? Number((exitPrice - trade.entryPrice).toFixed(2))
    : Number((trade.entryPrice - exitPrice).toFixed(2));
}

function netPnl(trade, exitPrice, model) {
  const gross = pnl(trade, exitPrice);
  const turnover = trade.entryPrice + exitPrice;
  const costs = turnover * model.costPercent / 100;
  return Number((gross - costs).toFixed(2));
}

function applySlippage(price, side, phase, model) {
  const slip = price * model.slippagePercent / 100;
  const worseForBuy = side === 'BUY' && phase === 'entry' || side === 'SELL' && phase === 'exit';
  return Number((worseForBuy ? price + slip : price - slip).toFixed(2));
}

function summarizeTrades(trades) {
  const closed = trades.filter((trade) => trade.exitReason !== 'OPEN_AT_RANGE_END');
  const wins = closed.filter((trade) => trade.pnl > 0);
  const losses = closed.filter((trade) => trade.pnl <= 0);
  const totalPnl = closed.reduce((sum, trade) => sum + trade.pnl, 0);
  const bestTrade = closed.reduce((best, trade) => !best || trade.pnl > best.pnl ? trade : best, null);
  const worstTrade = closed.reduce((worst, trade) => !worst || trade.pnl < worst.pnl ? trade : worst, null);
  const targetHits = closed.filter((trade) => String(trade.exitReason || '').includes('TARGET')).length;
  const slHits = closed.filter((trade) => String(trade.exitReason || '').includes('SL')).length;
  const dayPnl = new Map();
  for (const trade of closed) {
    const day = trade.exitTime ? new Date(trade.exitTime * 1000).toISOString().slice(0, 10) : 'unknown';
    dayPnl.set(day, Number(((dayPnl.get(day) || 0) + trade.pnl).toFixed(2)));
  }
  const dayValues = [...dayPnl.entries()].map(([day, pnlValue]) => ({ day, pnl: pnlValue }));
  const bestDay = dayValues.reduce((best, day) => !best || day.pnl > best.pnl ? day : best, null);
  const worstDay = dayValues.reduce((worst, day) => !worst || day.pnl < worst.pnl ? day : worst, null);
  return {
    totalTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    targetHits,
    slHits,
    successRatio: closed.length ? Number(((wins.length / closed.length) * 100).toFixed(2)) : 0,
    totalPnl: Number(totalPnl.toFixed(2)),
    averagePnl: closed.length ? Number((totalPnl / closed.length).toFixed(2)) : 0,
    highReturn: bestTrade?.pnl || 0,
    maxLoss: worstTrade?.pnl || 0,
    maxTargetHit: targetHits,
    maxProfitDay: bestDay?.pnl || 0,
    maxLossDay: worstDay?.pnl || 0,
    bestTrade,
    worstTrade,
    expectancy: closed.length ? Number((totalPnl / closed.length).toFixed(2)) : 0,
    maxDrawdown: calculateMaxDrawdown(closed),
  };
}

function calculateMaxDrawdown(trades) {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const trade of trades) {
    equity += trade.pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity - peak);
  }
  return Number(maxDrawdown.toFixed(2));
}

function getBacktestModel(options) {
  return {
    slippagePercent: Number(options.slippagePercent ?? 0.03),
    costPercent: Number(options.costPercent ?? 0.06),
    maxCandleRangePercent: Number(options.maxCandleRangePercent ?? 1.2),
    sameCandlePolicy: options.sameCandlePolicy || 'SL_FIRST',
  };
}

function normalizeTargetLevel(value) {
  const target = Number(value || 1);
  if (!Number.isInteger(target) || target < 1 || target > 5) return 1;
  return target;
}
