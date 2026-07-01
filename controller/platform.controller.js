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
  completeAdminBrokerCallback,
  connectAdminDataSource,
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
  testTelegramConnection,
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

export async function telegramTestAPI(req, res) {
  return handle(res, () => testTelegramConnection());
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

export async function connectAdminDataSourceAPI(req, res) {
  return handle(res, () => connectAdminDataSource());
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
  const code = callbackValue(req.query.auth_code || req.query.code);
  const isAdmin = isTruthyCallbackFlag(req.query.admin) || callbackValue(req.query.state).toLowerCase() === 'admin';
  if (!code) {
    return handleBrokerCallbackPage(res, isAdmin ? 'admin' : 'user', () => {
      throw new Error('Broker callback is missing auth code. Please start broker connect again from the app.');
    });
  }
  if (isAdmin) {
    return handleBrokerCallbackPage(res, 'admin', () => completeAdminBrokerCallback({ code }));
  }
  const mobile = callbackValue(req.query.mobile) || callbackValue(req.query.state);
  if (mobile) {
    return handleBrokerCallbackPage(res, 'user', () => completeUserBrokerCallback({
      broker: 'fyers',
      mobile,
      code,
      brokerId: callbackValue(req.query.brokerId),
    }));
  }
  return handleBrokerCallbackPage(res, 'admin', () => brokerAccess(code));
}

export async function upstoxCallbackAPI(req, res) {
  const code = callbackValue(req.query.code);
  if (!code) {
    return handleBrokerCallbackPage(res, 'user', () => {
      throw new Error('Broker callback is missing auth code. Please start broker connect again from the app.');
    });
  }
  return handleBrokerCallbackPage(res, 'user', () => completeUserBrokerCallback({
    broker: 'upstox',
    mobile: callbackValue(req.query.mobile) || callbackValue(req.query.state),
    code,
    brokerId: callbackValue(req.query.brokerId),
  }));
}

export function callbackValue(value) {
  if (Array.isArray(value)) return callbackValue(value[0]);
  if (value === undefined || value === null) return '';
  return String(value).split('?')[0].trim();
}

export function isTruthyCallbackFlag(value) {
  return ['1', 'true', 'yes'].includes(callbackValue(value).toLowerCase());
}

async function handleBrokerCallbackPage(res, role, fn) {
  try {
    const data = await fn();
    return renderCallbackPage(res, {
      brokerStatus: 'connected',
      role,
      message: `${data.broker || 'Broker'} connected successfully.`,
    });
  } catch (error) {
    return renderCallbackPage(res, {
      brokerStatus: 'error',
      role,
      message: error.message || String(error),
    });
  }
}

async function renderCallbackPage(res, params) {
  let frontendUrl = process.env.FRONTEND_URL || 'https://algo.foodcrisis.in';
  try {
    frontendUrl = (await getSettings()).frontend_url || frontendUrl;
  } catch {
    // Keep callback response available even if settings cannot be loaded.
  }
  const url = new URL(frontendUrl);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const isError = params.brokerStatus === 'error';
  const title = isError ? 'Broker connection failed' : 'Broker connected';
  const safeMessage = escapeHtml(params.message || '');
  const redirectUrl = escapeHtml(url.toString());
  res.status(isError ? 400 : 200).send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="5;url=${redirectUrl}" />
  <title>${title}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f7fb; color: #111827; }
    main { width: min(420px, calc(100vw - 32px)); background: #fff; border: 1px solid #e5e7eb; border-radius: 16px; box-shadow: 0 18px 50px rgba(15, 23, 42, .12); padding: 28px; text-align: center; }
    .mark { width: 52px; height: 52px; border-radius: 999px; margin: 0 auto 16px; display: grid; place-items: center; font-size: 30px; font-weight: 800; color: #fff; background: ${isError ? '#dc2626' : '#16a34a'}; }
    h1 { margin: 0 0 10px; font-size: 24px; line-height: 1.2; }
    p { margin: 0; color: #4b5563; line-height: 1.5; }
    .message { margin-top: 14px; padding: 12px; border-radius: 10px; background: ${isError ? '#fef2f2' : '#f0fdf4'}; color: ${isError ? '#991b1b' : '#166534'}; font-weight: 650; overflow-wrap: anywhere; }
    a { display: inline-block; margin-top: 20px; color: #1d4ed8; font-weight: 700; text-decoration: none; }
  </style>
</head>
<body>
  <main>
    <div class="mark">${isError ? '!' : '✓'}</div>
    <h1>${title}</h1>
    <p>You will be redirected to the app in <strong id="count">5</strong> seconds.</p>
    <div class="message">${safeMessage}</div>
    <a href="${redirectUrl}">Open app now</a>
  </main>
  <script>
    let count = 5;
    const el = document.getElementById('count');
    const timer = setInterval(() => {
      count -= 1;
      el.textContent = String(Math.max(count, 0));
      if (count <= 0) {
        clearInterval(timer);
        window.location.replace(${JSON.stringify(url.toString())});
      }
    }, 1000);
  </script>
</body>
</html>`);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function handle(res, fn) {
  try {
    const data = await fn();
    res.status(200).json({ ok: true, data });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || String(error) });
  }
}
