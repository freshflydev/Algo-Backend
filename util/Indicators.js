export function calculateEMA(values, period = 21) {
  if (!Array.isArray(values) || values.length === 0) return [];
  const k = 2 / (period + 1);
  const result = [];
  let ema = values[0];
  for (let i = 0; i < values.length; i++) {
    ema = i === 0 ? values[i] : values[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

export function toHeikinAshi(candles) {
  const output = [];
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const haClose = (candle.open + candle.high + candle.low + candle.close) / 4;
    const haOpen = i === 0
      ? (candle.open + candle.close) / 2
      : (output[i - 1].open + output[i - 1].close) / 2;
    const haHigh = Math.max(candle.high, haOpen, haClose);
    const haLow = Math.min(candle.low, haOpen, haClose);
    output.push({
      ...candle,
      open: haOpen,
      high: haHigh,
      low: haLow,
      close: haClose,
      sourceOpen: candle.open,
      sourceHigh: candle.high,
      sourceLow: candle.low,
      sourceClose: candle.close,
    });
  }
  return output;
}

export function arraysToCandles(data) {
  const candles = [];
  const length = Math.min(
    data.open?.length || 0,
    data.high?.length || 0,
    data.low?.length || 0,
    data.close?.length || 0,
    data.epoch?.length || 0,
  );
  for (let i = 0; i < length; i++) {
    candles.push({
      time: data.epoch[i],
      open: Number(data.open[i]),
      high: Number(data.high[i]),
      low: Number(data.low[i]),
      close: Number(data.close[i]),
      volume: Number(data.volume?.[i] || 0),
    });
  }
  return candles;
}

export function candlesToArrays(candles) {
  return {
    open: candles.map((c) => c.open),
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
    close: candles.map((c) => c.close),
    epoch: candles.map((c) => c.time),
    volume: candles.map((c) => c.volume || 0),
  };
}

