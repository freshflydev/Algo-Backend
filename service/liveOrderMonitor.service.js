import FyersAPI from 'fyers-api-v3';
import { getDb } from '../db/database.js';
import { monitorOpenOrders } from './order.service.js';
import { logEvent } from './log.service.js';

const { fyersDataSocket: DataSocket, fyersOrderSocket: OrderSocket } = FyersAPI;

let dataSocket = null;
let orderSocket = null;
let subscribedSymbols = new Set();

export function startLiveOrderMonitor() {
  refreshLiveSubscriptions();
  startOrderSocket();
}

export function refreshLiveSubscriptions() {
  const symbols = getOpenOrderSymbols();
  const admin = getAdminFyersAccount();
  if (!admin?.access_token || symbols.length === 0) return;

  if (!dataSocket) {
    dataSocket = DataSocket.getInstance(`${admin.api_key}:${admin.access_token}`, '', true);
    dataSocket.on('connect', () => {
      if (symbols.length) {
        dataSocket.subscribe(symbols);
        dataSocket.mode(dataSocket.LiteMode);
        subscribedSymbols = new Set(symbols);
        logEvent('info', 'data-ws', `Subscribed ${symbols.length} active order symbols`, { symbols });
      }
    });
    dataSocket.on('message', handleTick);
    dataSocket.on('error', (message) => logEvent('error', 'data-ws', 'Data websocket error', message));
    dataSocket.on('close', () => {
      dataSocket = null;
      subscribedSymbols = new Set();
      logEvent('warn', 'data-ws', 'Data websocket closed');
    });
    dataSocket.connect();
    dataSocket.autoreconnect?.();
    return;
  }

  const toSubscribe = symbols.filter((symbol) => !subscribedSymbols.has(symbol));
  const toUnsubscribe = [...subscribedSymbols].filter((symbol) => !symbols.includes(symbol));
  if (toSubscribe.length) dataSocket.subscribe(toSubscribe);
  if (toUnsubscribe.length) dataSocket.unsubscribe?.(toUnsubscribe);
  subscribedSymbols = new Set(symbols);
}

function startOrderSocket() {
  const accounts = getConnectedFyersAccounts();
  if (orderSocket || accounts.length === 0) return;
  const account = accounts[0];
  orderSocket = new OrderSocket(`${account.api_key}:${account.access_token}`, '', true);

  orderSocket.on('connect', () => {
    orderSocket.subscribe([
      orderSocket.orderUpdates,
      orderSocket.tradeUpdates,
      orderSocket.positionUpdates,
      orderSocket.edis,
      orderSocket.pricealerts,
    ]);
    logEvent('info', 'order-ws', 'FYERS order websocket connected');
  });
  orderSocket.on('orders', (message) => handleOrderUpdate('orders', message));
  orderSocket.on('trades', (message) => handleOrderUpdate('trades', message));
  orderSocket.on('positions', (message) => handleOrderUpdate('positions', message));
  orderSocket.on('error', (message) => logEvent('error', 'order-ws', 'Order websocket error', message));
  orderSocket.on('close', () => {
    orderSocket = null;
    logEvent('warn', 'order-ws', 'Order websocket closed');
  });
  orderSocket.autoreconnect?.();
  orderSocket.connect();
}

async function handleTick(message) {
  const symbol = message.symbol || message.n || message?.v?.symbol;
  const ltp = Number(message.ltp || message.lp || message?.v?.lp);
  if (!symbol || !Number.isFinite(ltp)) return;

  getDb().prepare(`
    INSERT INTO market_ticks(symbol, ltp, raw_json)
    VALUES (?, ?, ?)
  `).run(symbol, ltp, JSON.stringify(message));

  await monitorOpenOrders(symbol, ltp);
  refreshLiveSubscriptions();
}

function handleOrderUpdate(type, message) {
  logEvent('info', 'order-ws', `Received ${type} update`, message);
  const payload = message.orders || message.trades || message.positions || message;
  const orderTag = payload.orderTag || payload.order_tag || payload.ordertag;
  const status = payload.status || payload.orderStatus;
  if (!orderTag || !status) return;

  getDb().prepare(`
    UPDATE orders SET status = ?, raw_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE order_tag = ?
  `).run(String(status).toLowerCase(), JSON.stringify(message), orderTag);
}

function getOpenOrderSymbols() {
  return getDb().prepare(`
    SELECT DISTINCT symbol FROM orders WHERE status IN ('open', 'dry_run_open')
  `).all().map((row) => row.symbol);
}

function getAdminFyersAccount() {
  return getDb().prepare(`
    SELECT * FROM admin_brokers WHERE broker = 'fyers' AND is_connected = 1 LIMIT 1
  `).get();
}

function getConnectedFyersAccounts() {
  return getDb().prepare(`
    SELECT broker, api_key, access_token FROM user_brokers
    WHERE broker = 'fyers' AND is_connected = 1
    UNION ALL
    SELECT broker, api_key, access_token FROM admin_brokers
    WHERE broker = 'fyers' AND is_connected = 1
  `).all();
}

