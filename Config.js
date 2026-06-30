export const APP_ID = process.env.FYERS_APP_ID || "";
export const SECRET_KEY = process.env.FYERS_SECRET_KEY || "";
export const REDIRECT_URL = process.env.FYERS_REDIRECT_URL || "http://127.0.0.1:8080/api/callback/fyers";

export const MCX_CRUDE_FUTURE = process.env.MCX_CRUDE_FUTURE || "NOV";
export const MCX_GOLD_FUTURE = process.env.MCX_GOLD_FUTURE || "DEC";

export const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

export const DEFAULT_STOCKS_NAMES = (process.env.DEFAULT_STOCKS_NAMES || "SRF,DIXON,ATUL,BAJFINANCE")
  .split(",")
  .map((symbol) => symbol.trim())
  .filter(Boolean);
export const TIMEFRAME = Number(process.env.TIMEFRAME || 15);

export const ENV = process.env.NODE_ENV || "LOCAL";

export const ACCESS_CODE = process.env.FYERS_ACCESS_CODE || "";
export const AUTH_CODE = process.env.FYERS_AUTH_CODE || "";

export const LOCAL = process.env.LOCAL_MODE !== "false";
export const LIVEFEED = process.env.LIVEFEED === "true";
