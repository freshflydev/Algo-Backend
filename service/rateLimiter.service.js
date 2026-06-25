import { getSettings } from './platform.service.js';
import { logEvent } from './log.service.js';

let windowStartedAt = Date.now();
let callsInWindow = 0;
let upstoxOrderWindowStartedAt = Date.now();
let upstoxOrderCallsInWindow = 0;

export async function waitForFyersSlot(label = 'fyers') {
  const settings = getSettings();
  const maxPerSecond = Math.max(Number(settings.fyers_rate_limit_per_second || 20), 1);
  const windowMs = Math.max(Number(settings.fyers_rate_limit_safety_ms || 1100), 1000);
  const now = Date.now();

  if (now - windowStartedAt >= windowMs) {
    windowStartedAt = now;
    callsInWindow = 0;
  }

  if (callsInWindow >= maxPerSecond) {
    const waitMs = windowMs - (now - windowStartedAt);
    logEvent('debug', 'rate-limit', `Pausing ${waitMs}ms before ${label}`, { maxPerSecond, windowMs });
    await new Promise((resolve) => setTimeout(resolve, Math.max(waitMs, 0)));
    windowStartedAt = Date.now();
    callsInWindow = 0;
  }

  callsInWindow += 1;
}

export async function waitForUpstoxOrderSlot(label = 'upstox-order') {
  const settings = getSettings();
  const maxPerSecond = Math.max(Number(settings.upstox_order_rate_limit_per_second || 10), 1);
  const windowMs = Math.max(Number(settings.upstox_order_rate_limit_safety_ms || 1100), 1000);
  const now = Date.now();

  if (now - upstoxOrderWindowStartedAt >= windowMs) {
    upstoxOrderWindowStartedAt = now;
    upstoxOrderCallsInWindow = 0;
  }

  if (upstoxOrderCallsInWindow >= maxPerSecond) {
    const waitMs = windowMs - (now - upstoxOrderWindowStartedAt);
    logEvent('debug', 'rate-limit', `Pausing ${waitMs}ms before ${label}`, { maxPerSecond, windowMs });
    await new Promise((resolve) => setTimeout(resolve, Math.max(waitMs, 0)));
    upstoxOrderWindowStartedAt = Date.now();
    upstoxOrderCallsInWindow = 0;
  }

  upstoxOrderCallsInWindow += 1;
}
