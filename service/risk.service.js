import moment from 'moment-timezone';
import { getDb } from '../db/database.js';
import { getSettings } from './platform.service.js';

moment.tz.setDefault('Asia/Kolkata');

export function assertRiskAllowed({ user, symbol, entryPrice, stopLoss, candle }) {
  const settings = getSettings();
  const today = moment().format('YYYY-MM-DD');
  const userId = user.id;

  const closed = getDb().prepare(`
    SELECT COALESCE(SUM(
      CASE WHEN side = 'BUY' THEN (exit_price - entry_price) * quantity
           ELSE (entry_price - exit_price) * quantity END
    ), 0) as pnl
    FROM orders
    WHERE user_id = ? AND exited_at IS NOT NULL AND DATE(exited_at) = ?
  `).get(userId, today);

  if (closed.pnl <= -Math.abs(Number(settings.max_daily_loss_per_user || 3000))) {
    throw new Error('Daily loss limit reached.');
  }

  const tradesToday = getDb().prepare(`
    SELECT COUNT(*) as count FROM orders WHERE user_id = ? AND DATE(created_at) = ?
  `).get(userId, today).count;
  if (tradesToday >= Number(settings.max_trades_per_user_per_day || 4)) {
    throw new Error('Daily trade count limit reached.');
  }

  const slToday = getDb().prepare(`
    SELECT COUNT(*) as count FROM orders
    WHERE user_id = ? AND DATE(exited_at) = ? AND exit_reason = 'SL'
  `).get(userId, today).count;
  if (slToday >= Number(settings.max_sl_per_user_per_day || 2)) {
    throw new Error('Daily SL count limit reached.');
  }

  const lastSl = getDb().prepare(`
    SELECT exited_at FROM orders
    WHERE user_id = ? AND symbol = ? AND exit_reason = 'SL'
    ORDER BY exited_at DESC LIMIT 1
  `).get(userId, symbol);
  if (lastSl?.exited_at) {
    const cooldownUntil = moment(lastSl.exited_at).add(Number(settings.cooldown_after_sl_minutes || 30), 'minutes');
    if (moment().isBefore(cooldownUntil)) throw new Error('Symbol cooldown after SL is active.');
  }

  const riskPercent = Math.abs(entryPrice - stopLoss) / entryPrice * 100;
  if (riskPercent > Number(settings.max_entry_risk_percent || 0.45)) {
    throw new Error(`Entry risk ${riskPercent.toFixed(2)}% is above limit.`);
  }

  if (candle) {
    const candleRangePercent = Math.abs(candle.high - candle.low) / candle.open * 100;
    if (candleRangePercent > Number(settings.spike_candle_percent || 1.2)) {
      throw new Error('Spike candle filter blocked entry.');
    }
  }
}

