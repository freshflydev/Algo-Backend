import express from 'express';
import cors from 'cors';
import { init, authAPI, localTest, resetAPI, tokenAPI } from './controller/broker.controller.js';
import { priceAPI, strategyAPI } from './controller/candle.controller.js';
import { previousStock, stockDataAPI } from './controller/quotes.controller.js'
import { onStart } from './service/broker.service.js';
import { addStock, listStock, ohlcsData, removeStock, subscribeQuote, unsubscribeQuote } from './util/LiveFeeds.js';
import { disableScheduler, enableScheduler } from './scheduler/alertScheduler.js';
import { addStockAPI, listStockAPI, priceAlert, removeStockAPI, sendSignalAert } from './controller/alert.controller.js';
import { loadCandleDataFromFile } from './util/HistoryData.js';
import { SampleWSMessage } from './util/Utils.js';
import { initDatabase } from './db/database.js';
import {
  addInstrumentAPI,
  addUserWatchlistAPI,
  activeUserBrokerAPI,
  backtestSummariesAPI,
  brokerStatesAPI,
  connectAdminDataSourceAPI,
  connectUserBrokerAPI,
  dailyGannAPI,
  disableInstrumentAPI,
  disconnectUserBrokerAPI,
  fetchCandlesAPI,
  fyersCallbackAPI,
  getUserInstanceAPI,
  getUserStrategyConfigAPI,
  instancesAPI,
  intradayHaDojiBacktestAPI,
  intradayBacktestAPI,
  backtestMatrixAPI,
  instrumentTrendAPI,
  listDailyAnalysisAPI,
  listInstrumentsAPI,
  listStrategiesAdminAPI,
  listUsersOverviewAPI,
  listUserBrokersAPI,
  listUserStrategiesAPI,
  listUserWatchlistAPI,
  loginAPI,
  loginHistoryAPI,
  logsAPI,
  openOrdersAPI,
  performanceAPI,
  rebuildDailyAnalysisAPI,
  removeUserBrokerAPI,
  removeUserWatchlistAPI,
  settingsAPI,
  startUserInstanceAPI,
  stopUserInstanceAPI,
  swingBacktestAPI,
  swingHaDojiBacktestAPI,
  tradesAPI,
  updateStrategyAdminAPI,
  updateUserBrokerAPI,
  updateUserStrategyConfigAPI,
  updateUserStrategySubscriptionAPI,
  userStrategyHistoryAPI,
  userDetailsAPI,
  upsertUserAPI,
  upstoxCallbackAPI,
} from './controller/platform.controller.js';
import { enableAlgoSchedulers } from './scheduler/algoScheduler.js';
import { startLiveOrderMonitor } from './service/liveOrderMonitor.service.js';

process.on('unhandledRejection', (error) => {
  console.error('Unhandled async service error:', error);
});
process.on('uncaughtException', (error) => {
  console.error('Uncaught service error:', error);
});

function envEnabled(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

const app = express();
const allowedOrigins = new Set([
  'https://algo.foodcrisis.in',
  'https://www.algo.foodcrisis.in',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);
const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: false,
  maxAge: 86400,
  optionsSuccessStatus: 204,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());
app.get('/api/health', (req, res) => {
  res.status(200).json({ ok: true, service: 'Algo API', time: new Date().toISOString() });
});

// Express Server
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '127.0.0.1';
app.listen(port, host, () => {
  console.log(`Server is running on http://${host}:${port}`);
});

app.get('/', init)

// Broker Authentication
app.get('/auth',authAPI);
app.get('/test',localTest);
app.get('/reset',resetAPI);
app.get('/token',tokenAPI)

// Broker Quotes 
app.get('/price',priceAPI)
app.get('/v2/price',strategyAPI)
app.get('/ohlc',ohlcsData)

// Live Feed Quotes
app.get('/quotes',stockDataAPI)
app.get('/sub',async (req, res) => {
  let data =   subscribeQuote();
  res.status(200).json(data);
});
app.get('/unsub',async (req, res) => {
  let data =  unsubscribeQuote();
  res.status(200).json(data);
});

// Scheduler Controller
app.get('/enable', async (req, res) => {
  try{
    enableScheduler();
    res.status(200).json({status:"enabled"});
  } catch(err){
    res.status(200).json(err);
  }
});
app.get('/disable', async (req, res) => {
  try{
  disableScheduler();
  res.status(200).json({status:"disabled"});
  } catch(err){
    res.status(200).json(err);
  }
});

// Messenger Alert
app.get('/send', async (req, res) => {
  let data = await sendSignalAert();
  SampleWSMessage(data);
  res.status(200).json(data);
});

// Instrument List
app.get('/stock',listStockAPI)
app.get('/add/:name',addStockAPI)
app.get('/remove/:name',removeStockAPI)
app.get('/previous',previousStock)
app.get('/alert',priceAlert)

// Platform API
app.post('/api/login', loginAPI);
app.get('/api/login-history', loginHistoryAPI);
app.get('/api/admin/settings', settingsAPI);
app.post('/api/admin/settings', settingsAPI);
app.get('/api/admin/instruments', listInstrumentsAPI);
app.post('/api/admin/instruments', addInstrumentAPI);
app.get('/api/admin/instruments/:symbol/trend', instrumentTrendAPI);
app.delete('/api/admin/instruments/:symbol', disableInstrumentAPI);
app.post('/api/admin/candles/fetch', fetchCandlesAPI);
app.post('/api/admin/gann/daily', dailyGannAPI);
app.post('/api/admin/backtest/intraday', intradayBacktestAPI);
app.post('/api/admin/backtest/intraday-ha-doji', intradayHaDojiBacktestAPI);
app.post('/api/admin/backtest/swing', swingBacktestAPI);
app.post('/api/admin/backtest/swing-ha-doji', swingHaDojiBacktestAPI);
app.post('/api/admin/backtest/matrix', backtestMatrixAPI);
app.post('/api/admin/daily-analysis/rebuild', rebuildDailyAnalysisAPI);
app.get('/api/admin/daily-analysis', listDailyAnalysisAPI);
app.get('/api/admin/trades', tradesAPI);
app.get('/api/admin/brokers', brokerStatesAPI);
app.post('/api/admin/brokers/connect', connectAdminDataSourceAPI);
app.get('/api/admin/instances', instancesAPI);
app.get('/api/admin/open-orders', openOrdersAPI);
app.get('/api/admin/performance', performanceAPI);
app.get('/api/admin/backtests', backtestSummariesAPI);
app.get('/api/admin/logs', logsAPI);
app.get('/api/admin/strategies', listStrategiesAdminAPI);
app.put('/api/admin/strategies/:strategyCode', updateStrategyAdminAPI);
app.get('/api/admin/users', listUsersOverviewAPI);

app.post('/api/users', upsertUserAPI);
app.get('/api/users/:mobile', userDetailsAPI);
app.get('/api/users/:mobile/brokers', listUserBrokersAPI);
app.put('/api/users/:mobile/broker', updateUserBrokerAPI);
app.post('/api/users/:mobile/brokers/:brokerId/active', activeUserBrokerAPI);
app.post('/api/users/:mobile/brokers/:brokerId/disconnect', disconnectUserBrokerAPI);
app.delete('/api/users/:mobile/brokers/:brokerId', removeUserBrokerAPI);
app.post('/api/users/:mobile/connect', connectUserBrokerAPI);
app.post('/api/users/:mobile/start', startUserInstanceAPI);
app.post('/api/users/:mobile/stop', stopUserInstanceAPI);
app.get('/api/users/:mobile/instance', getUserInstanceAPI);
app.get('/api/users/:mobile/strategy-config', getUserStrategyConfigAPI);
app.put('/api/users/:mobile/strategy-config', updateUserStrategyConfigAPI);
app.get('/api/users/:mobile/strategies', listUserStrategiesAPI);
app.put('/api/users/:mobile/strategies/:strategyCode', updateUserStrategySubscriptionAPI);
app.get('/api/users/:mobile/strategies/:strategyCode/history', userStrategyHistoryAPI);
app.get('/api/users/:mobile/watchlist', listUserWatchlistAPI);
app.post('/api/users/:mobile/watchlist', addUserWatchlistAPI);
app.delete('/api/users/:mobile/watchlist/:symbol', removeUserWatchlistAPI);

app.get('/api/callback/fyers', fyersCallbackAPI);
app.get('/api/callback/upstox', upstoxCallbackAPI);

safeStartup('database init', () => initDatabase());

// Hostinger shared Node hosting is best used as the API process. Long-running
// jobs are opt-in so deploys do not start duplicated schedulers or websocket
// loops while Passenger/Node restarts the app.
if (envEnabled('AUTO_START_BROKER')) safeStartup('broker boot', () => onStart());
if (envEnabled('SCHEDULER_ENABLED')) safeStartup('algo schedulers', () => enableAlgoSchedulers());
if (envEnabled('LIVE_MONITOR_ENABLED')) safeStartup('live order monitor', () => startLiveOrderMonitor());
if (envEnabled('LOAD_LOCAL_CANDLES')) safeStartup('local candle file load', () => loadCandleDataFromFile());

function safeStartup(label, fn) {
  try {
    const result = fn();
    if (result?.catch) result.catch((error) => console.error(`${label} failed:`, error));
  } catch (error) {
    console.error(`${label} failed:`, error);
  }
}
