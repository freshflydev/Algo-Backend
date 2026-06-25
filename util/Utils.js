import { isSameDay,isSaturday,isSunday } from 'date-fns';
import moment from 'moment-timezone';

moment.tz.setDefault('Asia/Kolkata');

const RiskRewardRation = 2;
const TradeRiskPercetage = 0.38;

export const startTime = moment({ hour: 9, minute: 15 });
export const endTime = moment({ hour: 15, minute: 0 });
export const endTimeCommodity = moment({ hour: 22, minute: 0 });

export const nseHolidays = [
  new Date('2023-01-01'),
  new Date('2023-01-26'),
  new Date('2024-01-26'), // Republic Day
  new Date('2024-03-08'), // Maha Shivaratri
  new Date('2024-03-25'), // Holi
  new Date('2024-03-29'), // Good Friday
  new Date('2024-04-11'), // Eid-Ul-Fitr (Ramzan Eid)
  new Date('2024-04-17'), // Ram Navami
  new Date('2024-05-01'), // Maharashtra Day
  new Date('2024-06-17'), // Bakri Eid
  new Date('2024-07-17'), // Moharram
  new Date('2024-08-15'), // Independence Day
  new Date('2024-10-02'), // Mahatma Gandhi Jayanti
  new Date('2024-11-01'), // Diwali-Laxmi Pujan
  new Date('2024-11-15'), // Gurunanak Jayanti
  new Date('2024-12-25'), // Christmas
];

export const gannDate = [
  new Date('2024-11-11'),
  new Date('2024-11-19'),
  new Date('2024-12-07'),
  new Date('2024-12-23')
];


export function convertEpochToIST(epoch) {
    return moment.tz(epoch * 1000, 'Asia/Kolkata').format('YYYY-MM-DD hh:mm:ss A');
}

export function getCurrentDateInIST() {
  moment.tz.setDefault('Asia/Kolkata');
  const currentDateInIST = moment().format('YYYY-MM-DD');
  return currentDateInIST;
}

export function getYesterdayDateInIST() {
  moment.tz.setDefault('Asia/Kolkata');
  let yesterdayDateInIST = moment().subtract(1, 'days'); // Start with yesterday

  // Loop back until we find a day that is not a weekend and not a holiday
  while (yesterdayDateInIST.isoWeekday() === 6 || yesterdayDateInIST.isoWeekday() === 7) {
    yesterdayDateInIST.subtract(1, 'days'); // Go back one more day
  }
  
  return yesterdayDateInIST.format('YYYY-MM-DD');
}

export function isHoliday() {
  let date = new Date();
  return isSaturday(date) || isSunday(date) || nseHolidays.some(holiday => isSameDay(date, holiday));
}

export function isGANNDate() {
  let date = new Date();
  return gannDate.some(holiday => isSameDay(date, holiday));
}


// CANDLE TRANFORMATION
export function ohlcToCandles(ohlcData) {
  const candlesData = ohlcData.map((ohlc) => {
    return [ohlc.t, ohlc.open, ohlc.high, ohlc.low, ohlc.close, ohlc.vol];
  });
  let candles = {
    candles:candlesData
  }
  return candles;
}

// RISK REWARD UTIL
export function calculateRiskReward(entryPrice, slPrice) {
    const rrRatio = RiskRewardRation; // 1:2 RR ratio
  
    const isBuyTrade = entryPrice > slPrice;
  
    // true mean buy , false means sell 
    // Calculate the Risk
    const risk = (isBuyTrade == true) ? entryPrice - slPrice : slPrice - entryPrice;
    const riskPercentage = (risk / entryPrice) * 100;
  
    // Calculate the Reward
    const reward = risk * rrRatio;
    const rewardPercentage = (reward / entryPrice) * 100;
  
    // Calculate the TP price for a long trade
    const targetPrice = (isBuyTrade == true) ? entryPrice + reward : entryPrice - reward;
  
    const what = riskPercentage < TradeRiskPercetage ? true:false; 
    return {
      risk,
      reward,
      riskPercentage,
      rewardPercentage,
      targetPrice,
      what
    };
}

export function currentMonth (str) {
  const date = new Date();
  if (str && str.toLowerCase() === 'gold') {
    date.setMonth(date.getMonth() + 2);
}
  const options = { month: 'short' };
  const monthAbbreviation = date.toLocaleString('en-US', options).toUpperCase();
  return monthAbbreviation;
};

export function symbolName(i){
  if(i){
    let it = "-EQ";
    let st = "NSE";
    if(i == "NIFTY50" || i == "NIFTYBANK" || i == "FINNIFTY" || i == "MIDCPNIFTY" || i == "SENSEX"){
      it = "-INDEX";
    }
    if(i.includes("CRUDEOIL")){
      i += "24" + currentMonth();
      it = "FUT";
      st = "MCX"
    }
    if(i.includes("GOLD")){
      i+= "24" + currentMonth("gold");
      it = "FUT";
      st = "MCX"
    }
    return symbolName = st +':'+ i + it;
  }
}

export function combinePreviousTodayCandle(obj1, obj2) {
  const combined = {};

  // Combine array fields
  ['open', 'high', 'low', 'close', 'epoch', 'volume'].forEach(key => {
    combined[key] = [...(obj1[key] || []), ...(obj2[key] || [])];
  });

  // Preserve other fields like 'instrument' or any other future field
  combined.instrument = obj1.instrument // Use from obj1 or obj2, adjust as needed

  return combined;
}

export function SampleWSMessage(data){
  //broadcastMessage(JSON.stringify(data));
}

export function validateIntermediateCandles(heikenAshiCandles, startIdx, dojiHigh, dojiLow, tradeType) {
  for (let i = startIdx; i < heikenAshiCandles.length; i++) {
    const candle = heikenAshiCandles[i];
    
    if (tradeType === 'buy') {
      // For a buy trade, no candle should close below the Doji low
      if (candle.close < dojiLow) {
        return false;
      }
    } else if (tradeType === 'sell') {
      // For a sell trade, no candle should close above the Doji high
      if (candle.close > dojiHigh) {
        return false;
      }
    }
  }
  return true;
}