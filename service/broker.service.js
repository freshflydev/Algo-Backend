import FyersAPI from "fyers-api-v3"
import { fyersDataSocket as DataSocket } from "fyers-api-v3";
import cache from 'memory-cache';
import { refreshLiveFeedToken } from "../util/LiveFeeds.js";
import {APP_ID,SECRET_KEY,REDIRECT_URL, ACCESS_CODE, AUTH_CODE, LIVEFEED as LiveFeed} from "../Config.js"
import { enableScheduler } from "../scheduler/alertScheduler.js";
import fs from 'fs';
import path from 'path';
import { waitForFyersSlot } from "./rateLimiter.service.js";
import { getDb } from '../db/database.js';
const FILE_PATH = path.resolve('credentials.json');


var fyers = new FyersAPI.fyersModel();

export async function brokerAuth(){
  fyers.setRedirectUrl(REDIRECT_URL);
  let generateAuthcodeURL = await fyers.generateAuthCode();
  return generateAuthcodeURL
}

export async function brokerAccess(auth_code){
    try{
      let data = await fyers.generate_access_token({ "secret_key": SECRET_KEY, "auth_code": auth_code });
      if(data.code == 200){
        const {access_token,refresh_token} = data;
        cache.put('access_token', access_token, 86400000);
        cache.put('refresh_token', refresh_token, 86400000);
        cache.put('auth_code', auth_code, 86400000);
        if(LiveFeed)
          refreshLiveFeedToken(auth_code,data.access_token)
        writeTokensToFile(auth_code, access_token, refresh_token);
        setToken();
        return {"auth_code":auth_code,"access_token":access_token,"refresh_token":refresh_token,status:"authenticated"}
      }
      else {
        return data
      }
     } catch(error) {
      console.log(error)
      throw error;
    }
}

export function onLocalTest(startup){
  let tokenData = loadTokensFromFile();

  let auth_code,access_token,refresh_token;
  
  if (tokenData) {
    console.log("Loaded Credentials from File")
    // Use the tokens from the file if available
    auth_code = tokenData.auth_code;
    access_token = tokenData.access_token;
    refresh_token = tokenData.refresh_token;
  } else {
    // Fallback to default values
    auth_code = AUTH_CODE;
    access_token = ACCESS_CODE;
    refresh_token = "";
  }

  cache.put('auth_code', auth_code, 86400000);
  cache.put('access_token', access_token, 86400000);
  cache.put('refresh_token', refresh_token, 86400000);

  if(LiveFeed)
    refreshLiveFeedToken(auth_code,access_token)

  writeTokensToFile(auth_code, access_token, refresh_token);

  setToken();
}

export function resetAuth(){
  cache.clear();
}

export function getToken(){
  const keys = cache.keys();
  const cacheContent = keys.reduce((obj, key) => {
      obj[key] = cache.get(key);
      return obj;
  }, {});
  return cacheContent;
}

export function onStart(){
    fyers.setAppId(APP_ID);
    if(cache.get("access_token"))
      fyers.setAccessToken(cache.get("access_token"));

    if (isEnvEnabled('LEGACY_ALERT_SCHEDULER_ENABLED')) {
      enableScheduler();
    }
    onLocalTest();
} 

function isEnvEnabled(name) {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env[name] || '').trim().toLowerCase());
}

function setToken(){
  try{
    let access_token = cache.get('access_token');
    let token = access_token;
    fyers.setAccessToken(token);
  }catch(error){
    sendTelegramMessage("Bot Error : Please Authenticate");
  }
}

export function getAccessToken(){
  return cache.get('access_token');
}

export function getCache(key){
return cache.get(key);
}

// QUOTES API
export async function historyQuotes(inp){
    try {
      const dataSource = await getAdminFyersDataSource();
      const historyClient = dataSource || fyers;
      if (dataSource) {
        historyClient.setAppId(dataSource.api_key);
        historyClient.setAccessToken(dataSource.access_token);
      } else {
        setToken();
      }
      await waitForFyersSlot('history');
      const response = await historyClient.getHistory(inp);
      if(response.s=="error")
          throw new Error(response.message)
      return response;
    } catch (err) {
      console.error(err);
      throw err; // Re-throw the error if needed
    }
}

async function getAdminFyersDataSource() {
  const account = await getDb().prepare(`
    SELECT api_key, access_token
    FROM admin_brokers
    WHERE broker = 'fyers' AND is_connected = 1 AND access_token IS NOT NULL AND access_token != ''
    ORDER BY connected_at DESC, updated_at DESC
    LIMIT 1
  `).get();
  if (!account?.api_key || !account?.access_token) return null;
  const client = new FyersAPI.fyersModel();
  client.api_key = account.api_key;
  client.access_token = account.access_token;
  return client;
}

// DATA SOCKET
export function getDataSocketInstance(){
  return DataSocket.getInstance(APP_ID+":"+cache.get("access_token"),"",true);
}


// FILE TOKEN
function writeTokensToFile(auth_code, access_token, refresh_token) {
  const data = {
    auth_code,
    access_token,
    refresh_token,
  };

  // Write the data to a file in JSON format
  fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2));
}

// Function to load tokens from a file if it exists
function loadTokensFromFile() {
  if (fs.existsSync(FILE_PATH)) {
    const data = fs.readFileSync(FILE_PATH, 'utf-8');
    return JSON.parse(data);
  }
  return null;
}
