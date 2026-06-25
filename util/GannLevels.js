export function calculateGannLevels(price) {
  const daily_close = Number(price);
  if (!Number.isFinite(daily_close) || daily_close <= 0) {
    throw new Error('GANN source price must be a positive number.');
  }

  const j3 = 0.12;
  const j4 = 0.25;
  const j5 = 0.375;
  const j6 = 0.5;
  const j7 = 0.625;
  const j8 = 0.75;
  const j9 = 0.875;
  const j10 = 1;

  const sqrt = Math.sqrt(daily_close);
  const c6 = Math.floor(sqrt);
  const round = c6 - 1;
  const f6 = Math.round(Math.round(sqrt) === sqrt ? sqrt + 1 : Math.ceil(sqrt));

  const B8 = (f6 + j4) * (f6 + j4);
  const E8 = (f6 + j5) * (f6 + j5);
  const C8 = daily_close >= B8 && daily_close < E8 ? daily_close : 0;
  const H8 = (f6 + j6) * (f6 + j6);
  const F8 = daily_close >= E8 && daily_close < H8 ? daily_close : 0;

  const C9 = (c6 + j4) * (c6 + j4);
  const E9 = (c6 + j5) * (c6 + j5);
  const G9 = (c6 + j6) * (c6 + j6);

  const D10 = Math.pow(round + j4, 2);
  const E10 = Math.pow(round + j5, 2);
  const F10 = Math.pow(round + j6, 2);

  const B11 = (f6 + j3) * (f6 + j3);
  const C11 = (c6 + j3) * (c6 + j3);
  const F11 = Math.pow(round + j7, 2);
  const G11 = (c6 + j7) * (c6 + j7);
  const H11 = (f6 + j7) * (f6 + j7);

  const D12 = Math.pow(round + j10, 2);
  const E12 = Math.pow(round + j9, 2);
  const F12 = Math.pow(round + j8, 2);

  const C13 = (c6 + j10) * (c6 + j10);
  const E13 = (c6 + j9) * (c6 + j9);
  const G13 = (c6 + j8) * (c6 + j8);

  const B14 = (f6 + j10) * (f6 + j10);
  const E14 = (f6 + j9) * (f6 + j9);
  const H14 = (f6 + j8) * (f6 + j8);

  const D9 = daily_close >= C9 && daily_close < E9 ? daily_close : 0;
  const F9 = daily_close >= E9 && daily_close < G9 ? daily_close : 0;
  const H9 = daily_close >= H8 && daily_close < H11 ? daily_close : 0;

  const B10 = daily_close >= B11 && daily_close < B8 ? daily_close : 0;
  const C10 = daily_close >= C11 && daily_close < C9 ? daily_close : 0;
  const G10 = daily_close >= G11 && daily_close < G11 ? daily_close : 0;

  const C12 = daily_close >= D12 && daily_close < C11 ? daily_close : 0;
  const G12 = daily_close >= G11 && daily_close < G13 ? daily_close : 0;
  const H12 = daily_close >= H11 && daily_close < H14 ? daily_close : 0;

  const B13 = daily_close >= C13 && daily_close < B11 ? daily_close : 0;
  const D13 = daily_close >= E13 && daily_close < C13 ? daily_close : 0;
  const F13 = daily_close >= G13 && daily_close < E13 ? daily_close : 0;
  const D14 = daily_close >= G13 && daily_close < E13 ? daily_close : 0;
  const G14 = daily_close >= H14 && daily_close < E14 ? daily_close : 0;

  const pick = (...pairs) => {
    for (const [cond, value] of pairs) {
      if (cond !== 0) return value;
    }
    return 0;
  };

  const r1 = pick([C12, C9], [C10, E9], [D9, G9], [F9, G11], [G10, G13], [G12, E13], [F13, C13], [D13, B11], [B13, B8], [B10, E8], [C8, H8], [F8, H11], [H9, H14], [H12, E14], [G14, B14], [D14, B14]);
  const r2 = pick([C12, E9], [C10, G9], [D9, G11], [F9, G13], [G10, E13], [G12, C13], [F13, B11], [D13, B8], [B13, E8], [B10, H8], [C8, H11], [F8, H14], [H9, E14], [H12, B14], [G14, B14], [D14, B14]);
  const r3 = pick([C12, G9], [C10, G11], [D9, G13], [F9, E13], [G10, C13], [G12, B11], [F13, B8], [D13, E8], [B13, H8], [B10, H11], [C8, H14], [F8, E14], [H9, B14], [H12, B14], [G14, B14], [D14, B14]);
  const r4 = pick([C12, G11], [C10, G13], [D9, E13], [F9, C13], [G10, B11], [G12, B8], [F13, E8], [D13, H8], [B13, H11], [B10, H14], [C8, E14], [F8, B14], [H9, B14], [H12, B14], [G14, B14], [D14, B14]);
  const r5 = pick([C12, G13], [C10, E13], [D9, C13], [F9, B11], [G10, B8], [G12, E8], [F13, H8], [D13, H11], [B13, H14], [B10, E14], [C8, B14], [F8, B14], [H9, B14], [H12, B14], [G14, B14], [D14, B14]);

  const s1 = pick([C12, E12], [C10, D12], [D9, C11], [F9, C9], [G10, E9], [G12, G9], [F13, G11], [D13, G13], [B13, E13], [B10, C13], [C8, B11], [F8, B8], [H9, E8], [H12, H8], [G14, H11], [D14, H14]);
  const s2 = pick([C12, F12], [C10, E12], [D9, D12], [F9, C11], [G10, C9], [G12, E9], [F13, G9], [D13, G11], [B13, G13], [B10, E13], [C8, C13], [F8, B11], [H9, B8], [H12, E8], [G14, H8], [D14, H11]);
  const s3 = pick([C12, F11], [C10, F12], [D9, E12], [F9, D12], [G10, C11], [G12, C9], [F13, E9], [D13, G9], [B13, G11], [B10, G13], [C8, E13], [F8, C13], [H9, B11], [H12, B8], [G14, E8], [D14, H8]);
  const s4 = pick([C12, F10], [C10, F11], [D9, F12], [F9, E12], [G10, D12], [G12, C11], [F13, C9], [D13, E9], [B13, G9], [B10, G11], [C8, G13], [F8, E13], [H9, C13], [H12, B11], [G14, B8], [D14, E8]);
  const s5 = pick([C12, E10], [C10, F10], [D9, F11], [F9, F12], [G10, E12], [G12, D12], [F13, C11], [D13, C9], [B13, E9], [B10, G9], [C8, G11], [F8, G13], [H9, E13], [H12, C13], [G14, B11], [D14, B8]);

  let buy = pick([C12, C11], [C10, C9], [D9, E9], [F9, G9], [G10, G11], [G12, G13], [F13, E13], [D13, C13], [B13, B11], [B10, B8], [C8, E8], [F8, H8], [H9, H11], [H12, H14], [G14, E14], [D14, B14]);
  let sell = pick([C12, D12], [C10, C11], [D9, C9], [F9, E9], [G10, G9], [G12, G11], [F13, G13], [D13, E13], [B13, C13], [B10, B11], [C8, B8], [F8, E8], [H9, H8], [H12, H11], [G14, H14], [D14, E14]);
  let buyTargets = [r1, r2, r3, r4, r5];
  let sellTargets = [s1, s2, s3, s4, s5];

  if (!buy || !sell || buyTargets.some((value) => !value) || sellTargets.some((value) => !value)) {
    const fallback = fallbackSquareLevels(daily_close);
    buy = buy || fallback.buy;
    sell = sell || fallback.sell;
    buyTargets = buyTargets.map((value, index) => value || fallback.buyTargets[index]);
    sellTargets = sellTargets.map((value, index) => value || fallback.sellTargets[index]);
  }

  const scale = (value) => Number((value * 0.9995).toFixed(2));
  const round2 = (value) => Number(value.toFixed(2));

  return {
    sourcePrice: round2(daily_close),
    buy: round2(buy),
    buySl: round2(sell),
    buyTargets: buyTargets.map(scale),
    sell: round2(sell),
    sellSl: round2(buy),
    sellTargets: sellTargets.map(scale),
    raw: {
      r1, r2, r3, r4, r5, s1, s2, s3, s4, s5,
      buy, sell, buyrsl: sell, sellssl: buy,
    },
  };
}

function fallbackSquareLevels(price) {
  const angles = [0, 0.12, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
  const root = Math.sqrt(price);
  const base = Math.floor(root);
  const levels = [];
  for (let n = base - 3; n <= base + 4; n++) {
    if (n <= 0) continue;
    for (const angle of angles) {
      levels.push(Number(Math.pow(n + angle, 2).toFixed(6)));
    }
  }
  const sorted = [...new Set(levels)].sort((a, b) => a - b);
  const upperIndex = sorted.findIndex((level) => level > price);
  const lowerIndex = upperIndex > 0 ? upperIndex - 1 : 0;
  const buyIndex = upperIndex === -1 ? sorted.length - 1 : upperIndex;
  const sellIndex = lowerIndex;
  return {
    buy: sorted[buyIndex],
    sell: sorted[sellIndex],
    buyTargets: [1, 2, 3, 4, 5].map((offset) => sorted[Math.min(buyIndex + offset, sorted.length - 1)]),
    sellTargets: [1, 2, 3, 4, 5].map((offset) => sorted[Math.max(sellIndex - offset, 0)]),
  };
}
