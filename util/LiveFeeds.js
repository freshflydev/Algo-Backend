import { fyersDataSocket as DataSocket } from "fyers-api-v3";
import {DEFAULT_STOCKS_NAMES,TIMEFRAME,APP_ID} from "../Config.js"
import {ohlcToCandles,convertEpochToIST} from "../util/Utils.js"
import { getDataSocketInstance } from "../service/broker.service.js";

let STOCKS_NAMES = [...DEFAULT_STOCKS_NAMES];
// DATA
let stockData = {};
let ohlcData = {};  // 15 Minute Candle Data
let dayData = {};   // Daily Stock Data
let stockSignalData = new Map();

// PER MINUTE CANDLE DATA
let stockCandles = {}; // Object to store candles for each stock
const interval = 60000; // 1 minute in milliseconds

let skt;

export async function refreshLiveFeedToken(auth_code,access_token){
   skt = getDataSocketInstance();
}

export function addStock(stock){
  if(STOCKS_NAMES.indexOf(stock) == -1)
    return STOCKS_NAMES.push(stock);
}

export function removeStock(stock){
  const index = STOCKS_NAMES.indexOf(stock);
  if (index !== -1) {
    STOCKS_NAMES.splice(index, 1);
    return STOCKS_NAMES;
  }else{
    return "Stock Name Not Present"
  }
}

export function listStock(){
  return STOCKS_NAMES;
}

export function stocksData(){
  return stockData;
}

export function ohlcsData(){
  return ohlcData;
}

export function unsubscribeQuote(){
  try{
    let data = STOCKS_NAMES.map(name => 'NSE:'+name+'-EQ');
    const reqBody = {
      symbol:data,
      dataType:'symbolUpdate'
    }
    fyers.fyers_unsuscribe(reqBody)
  } catch(err){
    throw err;
  }
}

export function subscribeQuote(){
  let data = STOCKS_NAMES.map(name =>name);
  console.log(data)
    skt.on("connect",function(){
      skt.subscribe(data) 
      skt.mode(skt.LiteMode) ;
      skt.autoreconnect() ;
    })
    
    skt.on("message",function(message){
      if(message.type == "sf"){
      console.log(message)
      //1. Form Last 1 Minute Candle
      let candle = pipsToCandle(message);
      console.log(candle)
      // //2. Store that 1 Minute Candle data
      // let stockSymbol= message.symbol.replace("-EQ", "");
      // if (!stockData[stockSymbol]) {
      //   stockData[stockSymbol] = {
      //     quotes: [],
      //   };
      //   ohlcData[stockSymbol] = {
      //     ohlcData: [],
      //   };
      //   dayData[stockSymbol] = {
      //     today_high:q.v.high_price,
      //     prev_close:q.v.prev_close_price,
      //     today_low:q.v.low_price,
      //     total_buy:q.v.tot_buy,
      //     total_sell:q.v.tot_sell,
      //   };
      // }
      // //3. Analyse those Candles after 15 Minute
      // //4. Store Stock Day Data
      // const quote = convertToV2Format(message);     
      } 
    })
    
    skt.on("error",function(message){
      console.log("erroris",message)
    })
    
    skt.on("close",function(){
        console.log("socket closed")
    })
    skt.connect()
}

/* WEBSOCKET */
export function subscribeQuote1(){
  try{
    let data = STOCKS_NAMES.map(name => 'NSE:'+name+'-EQ');
    const reqBody = {
      symbol:data,
      dataType:'symbolUpdate'
    }
    fyers.fyers_connect(reqBody,function(req){
      //let quotes = quotesDataProcess(req)
      const quote = JSON.parse(req);
      console.log(quote)
      //console.log(quote)
      const transformedResponse = {
        "s": quote.s,
        "d": Object.entries(quote.d)
          .filter(([key, value]) => Array.isArray(value) && value.length > 0)
          .map(([key, value]) => ({
            "n": value[0].n,
            "s": value[0].s,
            "v": value[0].v
          }))
      };
      try{
        if(transformedResponse.d.length>0){
          transformedResponse.d.forEach((q)=>
          {        
            let stockSymbol= q.v.short_name.replace("-EQ", "");
            if (!stockData[stockSymbol]) {
              stockData[stockSymbol] = {
                quotes: [],
              };
              ohlcData[stockSymbol] = {
                ohlcData: [],
              };
              dayData[stockSymbol] = {
                today_high:q.v.high_price,
                prev_close:q.v.prev_close_price,
                today_low:q.v.low_price,
                total_buy:q.v.tot_buy,
                total_sell:q.v.tot_sell,
              };
            }
            stockData[stockSymbol].quotes.push(q);          
          })
        }
        return stockData;
      }catch(err){
        console.log(err)
      }
    })
  } catch(err){
    throw err;
  }
}

export function calculateOHLC(stockSymbol) {
  //console.log("caluclating ohlc for " + stockSymbol)
  // Calculate OHLC data as before...
  // Get the current IST time
  const currentTimeIST = convertEpochToIST(Math.floor(Date.now() / 1000));

  // Calculate the time 15 minutes ago
  const fifteenMinutesAgoIST = convertEpochToIST(Math.floor(Date.now() / 1000) - TIMEFRAME * 60);

  // Filter quotes within the last 15 minutes in IST for the specified stock
  const quotesWithin15Minutes = stockData[stockSymbol].quotes.filter((quote) => {
    const quoteTimeIST = convertEpochToIST(quote.v.cmd.t);
    return quoteTimeIST >= fifteenMinutesAgoIST && quoteTimeIST <= currentTimeIST;
  });

  if (quotesWithin15Minutes.length > 0) {
    // Calculate OHLC data for the specified stock
    const open = quotesWithin15Minutes[0].v.cmd.o;
    const vol = quotesWithin15Minutes[0].v.cmd.v;
    const close = quotesWithin15Minutes[quotesWithin15Minutes.length - 1].v.cmd.c;
    const high = Math.max(...quotesWithin15Minutes.map((quote) => quote.v.cmd.h));
    const low = Math.min(...quotesWithin15Minutes.map((quote) => quote.v.cmd.l));
    const t = Math.min(...quotesWithin15Minutes.map((quote) => quote.v.cmd.t));
    const lt = convertEpochToIST(t);
    const tt = Math.min(...quotesWithin15Minutes.map((quote) => quote.v.tt));
    const ltt = convertEpochToIST(tt);
    // Store OHLC data for the specified stock
    ohlcData[stockSymbol].ohlcData.push({
      time: currentTimeIST,
      lt: lt,
      open,
      high,
      low,
      close,
      vol,
      t,
      ltt
    });
  }

  // Clear old quotes data for the specified stock
  stockData[stockSymbol].quotes = stockData[stockSymbol].quotes.filter((quote) => {
    const quoteTimeIST = convertEpochToIST(quote.v.tt);
    //return quoteTimeIST >= fifteenMinutesAgoIST && quoteTimeIST <= currentTimeIST;
    return quoteTimeIST >= currentTimeIST;
  });
}

export function quotesFromMemory(stockSymbol) {
  if (stockData[stockSymbol] && ohlcData[stockSymbol].ohlcData) {
    const candles = ohlcToCandles(ohlcData[stockSymbol].ohlcData);
    return candles;
  }
  return [];
}

function pipsToCandle(data){
  try{
    const priceData = data// Adjust based on your data format
    const stockSymbol = priceData.symbol // Assuming the data includes a stock symbol
    const ltp = priceData.ltp;
    const timestamp = Math.floor(Date.now() / 1000);
    const roundedTime = Math.floor(timestamp / interval) * interval;

    console.log(convertEpochToIST(roundedTime))
    if (!stockCandles[stockSymbol]) {
      stockCandles[stockSymbol] = {};
    }

    if (!stockCandles[stockSymbol][roundedTime]) {
      stockCandles[stockSymbol][roundedTime] = {
        open: ltp,
        high: ltp,
        low: ltp,
        close: ltp,
        startTime: new Date(roundedTime),
      };
    } else {
      let candle = stockCandles[stockSymbol][roundedTime];
      candle.close = ltp;
      candle.closeTime = convertEpochToIST(timestamp);
      if (ltp > candle.high) candle.high = ltp;
      if (ltp < candle.low) candle.low = ltp;
      return candle;
    } 

  }catch(e){
    console.log(e)
  }
}

// Optional: Clear old candles to save memory
setInterval(() => {
  const now = Date.now();
  for (let stock in stockCandles) {
    for (let time in stockCandles[stock]) {
      if (now - time > interval * 60) { // Keep candles for the last 60 intervals
        delete stockCandles[stock][time];
      }
    }
  }
}, interval);

function convertToV2Format(source){
  return {
    "s": "ok",
    "d": [
        {
            "n": source.symbol,
            "s": "ok",
            "v": {
                "ch": source.ch,
                "chp": source.chp,
                "lp": source.ltp,
                "ask": source.ask_price,  
                "bid": source.bid_price,
                "open_price": source.open_price,
                "high_price": source.high_price,
                "low_price": source.low_price,
                "prev_close_price": source.prev_close_price,
                "volume": source.vol_traded_today,
                "short_name": source.symbol.split(':')[1],
                "exchange": source.symbol.split(':')[0],
                "description": source.symbol,
                "original_name": source.symbol,
                "symbol": source.symbol,
                "tt": source.last_traded_time,
                "tot_buy":source.tot_buy_qty,
                "tot_sell":source.tot_sell_qty,
                "cmd":{
                  "o":source.open_price,
                  "h":source.high_price,
                  "l": source.low_price,
                  "c":source.prev_close_price,
                  "t":source.last_traded_time,
                  "tt":source.last_traded_time
                }
            }
        }
    ]
  };
}