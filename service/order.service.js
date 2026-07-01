import FyersAPI from 'fyers-api-v3';
import { getDb, nowIso } from '../db/database.js';
import { getSettings } from './platform.service.js';
import { sendTelegramMessage } from '../integrations/Telegram.js';
import { waitForFyersSlot, waitForUpstoxOrderSlot } from './rateLimiter.service.js';
import { assertRiskAllowed } from './risk.service.js';
import { logEvent } from './log.service.js';

export async function placeStrategyOrder({ user, brokerAccount, strategy, symbol, side, entryPrice, stopLoss, targetPrice, targetLevel, candle = null }) {
  assertOrderLimit(user.id);
  assertRiskAllowed({ user, symbol, entryPrice, stopLoss, candle });
  const quantity = resolveQuantity(user, entryPrice, strategy);
  const product = strategy.includes('swing') ? 'DELIVERY' : 'INTRADAY';
  const orderTag = buildOrderTag(user.id, strategy, symbol);
  const settings = await getSettings();
  const dryRun = settings.dry_run_orders !== false;

  const orderId = createOrder({
    userId: user.id,
    broker: brokerAccount.broker,
    strategy,
    symbol,
    side,
    quantity,
    product,
    entryPrice,
    stopLoss,
    targetPrice,
    targetLevel,
    orderTag,
    status: dryRun ? 'dry_run_open' : 'placing',
  });

  if (dryRun) {
    await notifyOrder(orderId, 'DRY_RUN_ENTERED', entryPrice);
    await refreshLiveSubscriptionsSafe();
    return getOrder(orderId);
  }

  const response = await placeBrokerOrder(brokerAccount, {
    symbol,
    side,
    quantity,
    product,
    orderTag,
  });

  getDb().prepare(`
    UPDATE orders SET broker_order_id = ?, status = ?, raw_json = ?, updated_at = ? WHERE id = ?
  `).run(extractBrokerOrderId(response), 'open', JSON.stringify(response), nowIso(), orderId);
  await notifyOrder(orderId, 'ENTERED', entryPrice);
  await refreshLiveSubscriptionsSafe();
  return getOrder(orderId);
}

export async function exitOrder(order, exitPrice, reason) {
  if (!order || ['closed', 'dry_run_closed'].includes(order.status)) return order;
  const settings = await getSettings();
  const dryRun = settings.dry_run_orders !== false || order.status.startsWith('dry_run');
  if (!dryRun) {
    // Live exit is adapter-owned. For market exits we place an opposite side order
    // with the same tag suffix so the broker orderbook can be reconciled later.
    const userBroker = getDb().prepare(`
      SELECT ub.* FROM user_brokers ub WHERE ub.user_id = ? AND ub.broker = ?
    `).get(order.user_id, order.broker);
    await placeBrokerOrder(userBroker, {
      symbol: order.symbol,
      side: order.side === 'BUY' ? 'SELL' : 'BUY',
      quantity: order.quantity,
      product: order.product,
      orderTag: buildExitOrderTag(order.order_tag),
    });
  }

  const status = dryRun ? 'dry_run_closed' : 'closed';
  getDb().prepare(`
    UPDATE orders
    SET status = ?, exit_price = ?, exit_reason = ?, exited_at = ?, updated_at = ?
    WHERE id = ?
  `).run(status, exitPrice, reason, nowIso(), nowIso(), order.id);
  await notifyOrder(order.id, reason, exitPrice);
  await refreshLiveSubscriptionsSafe();
  return getOrder(order.id);
}

export function monitorOpenOrders(symbol, ltp) {
  const orders = getDb().prepare(`
    SELECT * FROM orders
    WHERE symbol = ? AND status IN ('open', 'dry_run_open')
  `).all(symbol);
  const actions = [];
  for (const order of orders) {
    if (order.side === 'BUY') {
      if (ltp >= order.target_price) actions.push(exitOrder(order, order.target_price, `TARGET_${order.target_level}`));
      if (ltp <= order.stop_loss) actions.push(exitOrder(order, order.stop_loss, 'SL'));
    } else {
      if (ltp <= order.target_price) actions.push(exitOrder(order, order.target_price, `TARGET_${order.target_level}`));
      if (ltp >= order.stop_loss) actions.push(exitOrder(order, order.stop_loss, 'SL'));
    }
  }
  return Promise.all(actions);
}

export async function forceCloseIntradayOrders() {
  const orders = getDb().prepare(`
    SELECT * FROM orders
    WHERE product = 'INTRADAY' AND status IN ('open', 'dry_run_open')
  `).all();
  const results = [];
  for (const order of orders) {
    results.push(await exitOrder(order, getLatestPrice(order.symbol) || order.entry_price, 'INTRADAY_FORCE_CLOSE'));
  }
  return results;
}

function createOrder(order) {
  const result = getDb().prepare(`
    INSERT INTO orders(
      user_id, broker, strategy, symbol, side, quantity, entry_price, stop_loss,
      target_price, target_level, order_tag, status, product
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    order.userId, order.broker, order.strategy, order.symbol, order.side, order.quantity,
    order.entryPrice, order.stopLoss, order.targetPrice, order.targetLevel, order.orderTag, order.status, order.product,
  );
  return Number(result.lastInsertRowid);
}

function getOrder(orderId) {
  return getDb().prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
}

function assertOrderLimit(userId) {
  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const open = getDb().prepare(`
    SELECT COUNT(*) as count FROM orders
    WHERE user_id = ? AND status IN ('open', 'placing', 'dry_run_open')
  `).get(userId).count;
  if (open >= user.max_concurrent_orders) {
    throw new Error('Max concurrent order limit reached for user.');
  }
}

function resolveQuantity(user, entryPrice, strategy) {
  const isSwing = strategy.includes('swing');
  const configuredExposure = isSwing ? user.swing_trade_amount : user.intraday_trade_amount;
  const leverage = Math.max(Number(isSwing ? user.swing_leverage : user.intraday_leverage) || 1, 1);
  const wallet = Number(isSwing ? user.swing_wallet : user.intraday_wallet) || 0;
  const maxByWallet = wallet * leverage;
  const maxOrderCapital = Math.min(Number(configuredExposure || 0), maxByWallet);
  return Math.max(1, Math.floor(maxOrderCapital / entryPrice));
}

async function placeBrokerOrder(brokerAccount, order) {
  if (brokerAccount.broker === 'fyers') {
    return placeFyersOrder(brokerAccount, order);
  }
  return placeUpstoxOrder(brokerAccount, order);
}

async function placeFyersOrder(account, order) {
  await waitForFyersSlot('place-order');
  const fyers = new FyersAPI.fyersModel();
  fyers.setAppId(account.api_key);
  fyers.setAccessToken(account.access_token);
  return fyers.place_order({
    symbol: order.symbol,
    qty: order.quantity,
    type: 2,
    side: order.side === 'BUY' ? 1 : -1,
    productType: order.product === 'DELIVERY' ? 'CNC' : 'INTRADAY',
    limitPrice: 0,
    stopPrice: 0,
    validity: 'DAY',
    disclosedQty: 0,
    offlineOrder: false,
    orderTag: order.orderTag,
  });
}

async function placeUpstoxOrder(account, order) {
  await waitForUpstoxOrderSlot('upstox-place-order');
  const response = await fetch('https://api-hft.upstox.com/v3/order/place', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${account.access_token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      quantity: order.quantity,
      product: order.product === 'DELIVERY' ? 'D' : 'I',
      validity: 'DAY',
      price: 0,
      tag: order.orderTag,
      instrument_token: order.symbol,
      order_type: 'MARKET',
      transaction_type: order.side,
      disclosed_quantity: 0,
      trigger_price: 0,
      is_amo: false,
      slice: true,
      market_protection: -1,
    }),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json?.message || 'Upstox order placement failed.');
  return json.data || json;
}

function buildOrderTag(userId, strategy, symbol) {
  return `AB3_${userId}_${strategy}_${symbol}_${Date.now()}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40);
}

function buildExitOrderTag(orderTag) {
  return `${orderTag}_X`.slice(0, 40);
}

function extractBrokerOrderId(response) {
  if (response?.orderId || response?.id) return response.orderId || response.id;
  if (Array.isArray(response?.order_ids)) return response.order_ids.join(',');
  if (Array.isArray(response?.data?.order_ids)) return response.data.order_ids.join(',');
  return null;
}

async function notifyOrder(orderId, eventType, price) {
  const order = getOrder(orderId);
  getDb().prepare(`
    INSERT INTO order_events(order_id, event_type, price, message)
    VALUES (?, ?, ?, ?)
  `).run(orderId, eventType, price, `${order.symbol} ${order.side} ${eventType} @ ${price}`);
  await sendTelegramMessage(`${order.symbol} ${order.side} ${eventType}\nStrategy: ${order.strategy}\nPrice: ${price}\nTag: ${order.order_tag}`);
  logEvent('info', 'order', `${order.symbol} ${eventType}`, { orderId, price, tag: order.order_tag });
}

async function refreshLiveSubscriptionsSafe() {
  const module = await import('./liveOrderMonitor.service.js');
  module.refreshLiveSubscriptions();
}

function getLatestPrice(symbol) {
  const tick = getDb().prepare(`
    SELECT ltp FROM market_ticks WHERE symbol = ? ORDER BY id DESC LIMIT 1
  `).get(symbol);
  if (tick?.ltp) return tick.ltp;
  const candle = getDb().prepare(`
    SELECT close FROM candles WHERE symbol = ? ORDER BY candle_time DESC LIMIT 1
  `).get(symbol);
  return candle?.close || null;
}
