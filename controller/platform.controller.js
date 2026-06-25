import {
  addInstrument,
  addInstrumentWithInitialSync,
  addUserWatchlistSymbol,
  backtestIntradayHaDoji,
  backtestIntraday,
  backtestStrategyMatrix,
  backtestSwing,
  backtestSwingHaDoji,
  calculateAndStoreDailyGannLevels,
  completeUserBrokerCallback,
  connectUserBroker,
  disableInstrument,
  fetchAndStoreCandles,
  getSettings,
  getUserStrategyConfig,
  getUserInstance,
  listLoginHistory,
  listInstruments,
  listStrategiesAdmin,
  listStrategiesForUser,
  listUserStrategyHistory,
  listUserBrokers,
  listUserWatchlist,
  listTrades,
  loginWithMobile,
  disconnectUserBroker,
  removeUserBroker,
  setActiveUserBroker,
  startUserInstance,
  stopUserInstance,
  updateStrategyAdmin,
  updateSettings,
  updateUserStrategySubscription,
  removeUserWatchlistSymbol,
  updateUserStrategyConfig,
  updateUserBroker,
  upsertUser,
} from '../service/platform.service.js';
import { listDailyAnalysis, listInstrumentTrend, rebuildDailyAnalysis } from '../service/dailyAnalysis.service.js';
import { brokerAccess } from '../service/broker.service.js';
import {
  backtestSummaries,
  getUserDetails,
  listBrokerStates,
  listInstances,
  listLogs,
  listOpenOrders,
  listUsersOverview,
  strategyPerformance,
} from '../service/dashboard.service.js';

export async function settingsAPI(req, res) {
  if (req.method === 'POST') return handle(res, () => updateSettings(req.body));
  return handle(res, () => getSettings());
}

export async function loginAPI(req, res) {
  return handle(res, () => loginWithMobile(req.body));
}

export async function loginHistoryAPI(req, res) {
  return handle(res, () => listLoginHistory(req.query));
}

export async function listInstrumentsAPI(req, res) {
  return handle(res, () => listInstruments(req.query.category));
}

export async function addInstrumentAPI(req, res) {
  return handle(res, () => addInstrumentWithInitialSync(req.body));
}

export async function disableInstrumentAPI(req, res) {
  return handle(res, () => disableInstrument(req.params.symbol));
}

export async function upsertUserAPI(req, res) {
  return handle(res, () => upsertUser(req.body));
}

export async function updateUserBrokerAPI(req, res) {
  return handle(res, () => updateUserBroker(req.params.mobile, req.body));
}

export async function listUserBrokersAPI(req, res) {
  return handle(res, () => listUserBrokers(req.params.mobile));
}

export async function activeUserBrokerAPI(req, res) {
  return handle(res, () => setActiveUserBroker(req.params.mobile, req.params.brokerId));
}

export async function disconnectUserBrokerAPI(req, res) {
  return handle(res, () => disconnectUserBroker(req.params.mobile, req.params.brokerId));
}

export async function removeUserBrokerAPI(req, res) {
  return handle(res, () => removeUserBroker(req.params.mobile, req.params.brokerId));
}

export async function connectUserBrokerAPI(req, res) {
  return handle(res, () => connectUserBroker(req.params.mobile, req.body.brokerId || req.body.broker));
}

export async function startUserInstanceAPI(req, res) {
  return handle(res, () => startUserInstance(req.params.mobile));
}

export async function stopUserInstanceAPI(req, res) {
  return handle(res, () => stopUserInstance(req.params.mobile));
}

export async function getUserInstanceAPI(req, res) {
  return handle(res, () => getUserInstance(req.params.mobile));
}

export async function getUserStrategyConfigAPI(req, res) {
  return handle(res, () => getUserStrategyConfig(req.params.mobile));
}

export async function updateUserStrategyConfigAPI(req, res) {
  return handle(res, () => updateUserStrategyConfig(req.params.mobile, req.body));
}

export async function listUserStrategiesAPI(req, res) {
  return handle(res, () => listStrategiesForUser(req.params.mobile));
}

export async function updateUserStrategySubscriptionAPI(req, res) {
  return handle(res, () => updateUserStrategySubscription(req.params.mobile, req.params.strategyCode, req.body));
}

export async function userStrategyHistoryAPI(req, res) {
  return handle(res, () => listUserStrategyHistory(req.params.mobile, req.params.strategyCode));
}

export async function listStrategiesAdminAPI(req, res) {
  return handle(res, () => listStrategiesAdmin());
}

export async function updateStrategyAdminAPI(req, res) {
  return handle(res, () => updateStrategyAdmin(req.params.strategyCode, req.body));
}

export async function listUserWatchlistAPI(req, res) {
  return handle(res, () => listUserWatchlist(req.params.mobile));
}

export async function addUserWatchlistAPI(req, res) {
  return handle(res, () => addUserWatchlistSymbol(req.params.mobile, req.body));
}

export async function removeUserWatchlistAPI(req, res) {
  return handle(res, () => removeUserWatchlistSymbol(req.params.mobile, req.params.symbol, req.query.watchlistName));
}

export async function fetchCandlesAPI(req, res) {
  return handle(res, () => fetchAndStoreCandles(req.body));
}

export async function dailyGannAPI(req, res) {
  return handle(res, () => calculateAndStoreDailyGannLevels(req.body));
}

export async function intradayBacktestAPI(req, res) {
  return handle(res, () => backtestIntraday(req.body));
}

export async function swingBacktestAPI(req, res) {
  return handle(res, () => backtestSwing(req.body));
}

export async function intradayHaDojiBacktestAPI(req, res) {
  return handle(res, () => backtestIntradayHaDoji(req.body));
}

export async function swingHaDojiBacktestAPI(req, res) {
  return handle(res, () => backtestSwingHaDoji(req.body));
}

export async function backtestMatrixAPI(req, res) {
  return handle(res, () => backtestStrategyMatrix(req.body));
}

export async function tradesAPI(req, res) {
  return handle(res, () => listTrades(req.query));
}

export async function rebuildDailyAnalysisAPI(req, res) {
  return handle(res, () => rebuildDailyAnalysis(req.body));
}

export async function listDailyAnalysisAPI(req, res) {
  return handle(res, () => listDailyAnalysis(req.query));
}

export async function instrumentTrendAPI(req, res) {
  return handle(res, () => listInstrumentTrend(req.params.symbol, req.query.limit));
}

export async function listUsersOverviewAPI(req, res) {
  return handle(res, () => listUsersOverview());
}

export async function userDetailsAPI(req, res) {
  return handle(res, () => getUserDetails(req.params.mobile));
}

export async function brokerStatesAPI(req, res) {
  return handle(res, () => listBrokerStates());
}

export async function instancesAPI(req, res) {
  return handle(res, () => listInstances());
}

export async function openOrdersAPI(req, res) {
  return handle(res, () => listOpenOrders());
}

export async function performanceAPI(req, res) {
  return handle(res, () => strategyPerformance());
}

export async function backtestSummariesAPI(req, res) {
  return handle(res, () => backtestSummaries());
}

export async function logsAPI(req, res) {
  return handle(res, () => listLogs(req.query));
}

export async function fyersCallbackAPI(req, res) {
  if (req.query.mobile) {
    return handle(res, () => completeUserBrokerCallback({
      broker: 'fyers',
      mobile: req.query.mobile,
      code: req.query.auth_code || req.query.code,
      brokerId: req.query.brokerId,
    }));
  }
  return handle(res, () => brokerAccess(req.query.auth_code || req.query.code));
}

export async function upstoxCallbackAPI(req, res) {
  return handle(res, () => completeUserBrokerCallback({
    broker: 'upstox',
    mobile: req.query.mobile || req.query.state,
    code: req.query.code,
    brokerId: req.query.brokerId,
  }));
}

async function handle(res, fn) {
  try {
    const data = await fn();
    res.status(200).json({ ok: true, data });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || String(error) });
  }
}
