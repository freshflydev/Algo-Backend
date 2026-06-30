import { getDb } from '../db/database.js';
import { listLogs } from './log.service.js';

export async function getUserDetails(mobile) {
  const user = await getDb().prepare('SELECT * FROM users WHERE mobile = ?').get(mobile);
  if (!user) throw new Error('User not found.');
  const brokers = await getDb().prepare(`
    SELECT id, broker, label, api_key, redirect_url, token_expires_at, is_active, is_connected, connected_at, updated_at
    FROM user_brokers
    WHERE user_id = ?
    ORDER BY is_active DESC, updated_at DESC
  `).all(user.id);
  const instance = await getDb().prepare('SELECT * FROM algo_instances WHERE user_id = ?').get(user.id) || { status: 'stopped' };
  const config = await getDb().prepare('SELECT * FROM user_strategy_configs WHERE user_id = ?').get(user.id);
  const watchlist = await getDb().prepare('SELECT symbol, watchlist_name FROM user_watchlists WHERE user_id = ? ORDER BY symbol').all(user.id);
  const openOrders = await getDb().prepare('SELECT * FROM orders WHERE user_id = ? AND status IN (\'open\', \'dry_run_open\', \'placing\')').all(user.id);
  return { user, brokers, instance, config, watchlist, openOrders };
}

export async function listBrokerStates() {
  return getDb().prepare(`
    SELECT u.mobile, ub.broker, ub.label, ub.is_active, ub.is_connected, ub.connected_at, ub.updated_at
    FROM user_brokers ub
    JOIN users u ON u.id = ub.user_id
    ORDER BY u.mobile, ub.is_active DESC, ub.broker
  `).all();
}

export function listUsersOverview() {
  return getDb().prepare(`
    SELECT
      u.id,
      u.mobile,
      u.name,
      u.is_active,
      u.intraday_wallet,
      u.swing_wallet,
      u.total_realized_pnl,
      ai.status AS instance_status,
      GROUP_CONCAT(DISTINCT ub.broker || ':' || CASE WHEN ub.is_active = 1 THEN 'active' ELSE 'saved' END) AS brokers,
      GROUP_CONCAT(DISTINCT CASE WHEN us.enabled = 1 THEN us.strategy_code END) AS strategies,
      COUNT(DISTINCT CASE WHEN o.status IN ('open', 'dry_run_open', 'placing') THEN o.id END) AS active_trades,
      COALESCE(SUM(
        CASE
          WHEN o.status NOT IN ('open', 'dry_run_open', 'placing') AND o.side = 'BUY' THEN (o.exit_price - o.entry_price) * o.quantity
          WHEN o.status NOT IN ('open', 'dry_run_open', 'placing') AND o.side = 'SELL' THEN (o.entry_price - o.exit_price) * o.quantity
          ELSE 0
        END
      ), 0) AS day_pnl
    FROM users u
    LEFT JOIN algo_instances ai ON ai.user_id = u.id
    LEFT JOIN user_brokers ub ON ub.user_id = u.id
    LEFT JOIN user_strategy_subscriptions us ON us.user_id = u.id
    LEFT JOIN orders o ON o.user_id = u.id AND DATE(o.created_at) = DATE('now')
    GROUP BY u.id
    ORDER BY u.updated_at DESC
  `).all();
}

export async function listInstances() {
  return getDb().prepare(`
    SELECT u.mobile, ai.status, ai.started_at, ai.stopped_at, ai.updated_at
    FROM users u
    LEFT JOIN algo_instances ai ON ai.user_id = u.id
    ORDER BY u.mobile
  `).all();
}

export async function listOpenOrders() {
  return getDb().prepare(`
    SELECT o.*, u.mobile
    FROM orders o
    JOIN users u ON u.id = o.user_id
    WHERE o.status IN ('open', 'dry_run_open', 'placing')
    ORDER BY o.created_at DESC
  `).all();
}

export async function strategyPerformance() {
  const rows = await getDb().prepare(`
    SELECT strategy, symbol, stats_json, created_at
    FROM backtests
    ORDER BY id DESC
    LIMIT 200
  `).all();
  const grouped = new Map();
  for (const row of rows) {
    const stats = JSON.parse(row.stats_json);
    const current = grouped.get(row.strategy) || {
      strategy: row.strategy,
      runs: 0,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      totalPnl: 0,
      maxDrawdown: 0,
    };
    current.runs += 1;
    current.totalTrades += stats.totalTrades || 0;
    current.wins += stats.wins || 0;
    current.losses += stats.losses || 0;
    current.totalPnl += stats.totalPnl || 0;
    current.maxDrawdown = Math.min(current.maxDrawdown, stats.maxDrawdown || 0);
    grouped.set(row.strategy, current);
  }
  return [...grouped.values()].map((item) => ({
    ...item,
    successRatio: item.totalTrades ? Number((item.wins / item.totalTrades * 100).toFixed(2)) : 0,
    totalPnl: Number(item.totalPnl.toFixed(2)),
  }));
}

export async function backtestSummaries() {
  const rows = await getDb().prepare(`
    SELECT id, strategy, symbol, range_from, range_to, stats_json, created_at
    FROM backtests
    ORDER BY id DESC
    LIMIT 100
  `).all();
  return rows.map((row) => ({ ...row, stats: JSON.parse(row.stats_json), stats_json: undefined }));
}

export { listLogs };
