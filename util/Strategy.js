import { findHeikenAshiDoji, isDojiCandle } from "./pattern.js";
import {convertEpochToIST,calculateRiskReward} from "./Utils.js"
import HeikinAshi from "heikinashi";
import { calculateGannLevels } from "./GannLevels.js";

export function FifteenMinuteStrategyWithGANN(data,param) {
  try{
  let quoteData = validateData(data);
  let heikenAshiData = calculateHeikinAshi(data);
  let {lowArray,closeArray,openArray,highArray,epochArray} = quoteData;
  // Strategy Variables
  const {
    quant,
    maxtrade,
  } = strategyOptions;
  const dayOpening = openArray[0];
  const dayClose = closeArray[closeArray.length-1];
  // Gann Strategy
  let trendPrice = GANN(dayOpening);
  // Signal Variables
  let currentTradeEntry = null;
  let currentTradeType = null;
  let currentTradeStartTime = null;
  let currentTradeSL = null;
  let currentTradeTrail = null;
  let trailedSL = false;
  let totalProfit = 0;
  let firstCandle = true;
  let PASignal = false;
  let GNSignal = false;
  let PAChange = false;
  let GNChange = false;
  // Signal Data
  const tradeHistory = [];
  const recentTradeHistory = [];
  const ongoingTrade = {};
  const signalsHistory = [];
  const signals = [];
  // Strategy Start
  if(tradeHistory.length != maxtrade-1){ // SAFE CHECK

    for (let i = 1; i < lowArray.length; i++) {
      ongoingTrade.Action = "Live";
      let riskCheck = null;
      const prevLow = lowArray[i - 1];
      const currentClose = closeArray[i];
      const prevHigh = highArray[i - 1];
      const currentEpoch = convertEpochToIST(epochArray[i]);

      // TESTING
      //console.log(i + " " + lowArray.length + " " + closeArray[i] + " " + currentEpoch)

      // GANN SIGNAL LOGIC 
      if(currentClose > trendPrice.b)
      {
        riskCheck = calculateRiskReward(currentClose,prevLow); 
        let signal = {type:"BUY GN",time:currentEpoch,closePrice:trendPrice.b,sl:prevLow,risk:riskCheck.riskPercentage}
        if(GNSignal== false || GNSignal == 'S'){
          GNSignal = 'B';
          // Recent Signal
          if((i)==(lowArray.length-1)){
          // signalsHistory.push(signal);
            GNChange = true;
          }
        }
      }
      if(currentClose < trendPrice.s)
      {
        riskCheck = calculateRiskReward(currentClose,prevLow); 
        let signal = {type:"SELL GN",time:currentEpoch,closePrice:trendPrice.s,sl:prevHigh,risk:riskCheck.riskPercentage}
        if(GNSignal== false || GNSignal == 'B'){
          GNSignal = 'S';
          // Recent Signal
          if((i)==(lowArray.length-1)){
          //  signalsHistory.push(signal);
            GNChange = true;
          }
        }
      }

      if(lowArray.length > 1) 
      {
        const prevLowPA = lowArray[i - 2];
        const currentClosePA  = closeArray[i-1];
        const prevHighPA  = highArray[i - 2];
        // PRICE ACTION SIGNAL LOGIC
        if(currentClosePA >= prevHighPA)
        {
          riskCheck = calculateRiskReward(currentClose,prevLow); 
          let signal = {type:"BUY",time:currentEpoch,closePrice:currentClose,sl:prevLow,risk:riskCheck.riskPercentage}
          if(PASignal== false || PASignal == 'S'){
            //signalsHistory.push(signal);
            PASignal = 'B';
            // ADD Recent Signal
            if((i-1)==(lowArray.length-2)){
              console.log("recent buy signal " + signal + " " + currentEpoch +  " " + i + " " + lowArray.length + " " + closeArray.length)
              signalsHistory.push(signal);
              PAChange = true;
            }
            signals.push(signal)
          }
        }
        if(currentClosePA <= prevLowPA)
        {
          riskCheck = calculateRiskReward(currentClose,prevLow); 
          let signal = {type:"SELL",time:currentEpoch,closePrice:currentClose,sl:prevHigh,risk:riskCheck.riskPercentage}
          if(PASignal== false || PASignal == 'B'){
            //signalsHistory.push(signal);
            PASignal = 'S';
            // ADD Recent Signal
            if((i)==(lowArray.length-1)){
              console.log("recent sell signal " + signal + " " + currentEpoch +  " " + i + " " + lowArray.length + " " + closeArray.length)
              signalsHistory.push(signal);
              PAChange = true;
            }
            signals.push(signal)
          }
        }
        if(heikenAshiData.currentDoji){
          let signal = {type:"DOJI",time:currentEpoch,closePrice:currentClose,sl:prevHigh}
          if((i)==(lowArray.length-1)){
            signalsHistory.push(signal);
          }
        }
      }
      // TRAIL OR CLOSE ACTIVE BUY TRADE
      if (currentTradeType === "buy") {
        if (currentClose > prevHigh) {  
          currentTradeSL = prevLow;
          trailedSL = true;
          ongoingTrade.Action = "Trailed";
        }
        if (currentClose >= currentTradeTrail  || currentClose <= currentTradeSL) {
          let priceClose = currentClose;
          const profit = (priceClose-currentTradeEntry) * quant;
          totalProfit += profit;
          tradeHistory.push({
            type: "buy",
            entryTime: currentTradeStartTime,
            closeTime: currentEpoch,
            entryPrice: currentTradeEntry,
            closePrice: priceClose,
            stoploss: currentTradeSL,
            targetPrice : currentTradeTrail,
            reward: profit,
            wasSLTrailed:trailedSL,
            status:"Closed",
          });
          // Add Recent Closed Trade
          if(i==(lowArray.length-1)){
            recentTradeHistory.push({
              type: "buy",
              entryTime: currentTradeStartTime,
              closeTime: currentEpoch,
              entryPrice: currentTradeEntry,
              closePrice: priceClose,
              stoploss: currentTradeSL,
              targetPrice : currentTradeTrail,
              reward: profit,
              wasSLTrailed:trailedSL,
              status:"Closed",
            });
          }
          currentTradeEntry = null;
          currentTradeType = null;
          currentTradeSL = null;
        }
      } // TRAIL OR CLOSE ACTIVE SELL TRADE
      else if (currentTradeType === "sell") {  
        if (currentClose < prevLow) {
          currentTradeSL = prevHigh;
          trailedSL = true;
          ongoingTrade.Action = "Trailed";
        }
        if (currentClose <= currentTradeTrail || currentClose >= currentTradeSL) {
          let priceClose =  currentClose;
          const profit =  (currentTradeEntry - priceClose) * quant;
          totalProfit += profit;
          tradeHistory.push({
            type: "sell",
            entryTime: currentTradeStartTime,
            closeTime: currentEpoch,
            entryPrice: currentTradeEntry,
            closePrice: priceClose,
            stoploss: currentTradeSL,
            targetPrice : currentTradeTrail,
            reward: profit,
            wasSLTrailed:trailedSL,
            status:"Closed",
          });
           // Add Recent Closed Trade
          if(i==(lowArray.length-1)){
            recentTradeHistory.push({
              type: "sell",
              entryTime: currentTradeStartTime,
              closeTime: currentEpoch,
              entryPrice: currentTradeEntry,
              closePrice: priceClose,
              stoploss: currentTradeSL,
              targetPrice : currentTradeTrail,
              reward: profit,
              wasSLTrailed:trailedSL,
              status:"Closed",
            });
          }
          currentTradeEntry = null;
          currentTradeType = null;
          currentTradeSL = null;
          currentTradeTrail = null;
        }
      } // INITATE NEW TRADE
      else {
        // No active trade, check if a trade should be initiated
        if (currentClose > prevHigh && currentClose >= trendPrice.b) {     
          riskCheck = calculateRiskReward(currentClose,prevLow);   
          //if(firstCandle || riskCheck.what==true)  {
          if(riskCheck.what==true)  {
            currentTradeEntry = currentClose;
            currentTradeType = "buy";
            currentTradeStartTime = currentEpoch;
            currentTradeSL = prevLow;       
            currentTradeTrail  = riskCheck.targetPrice;
            ongoingTrade.type = "buy";
            ongoingTrade.price = currentClose;
            ongoingTrade.openTime = currentEpoch;
            ongoingTrade.sl = prevLow;
            ongoingTrade.target = riskCheck.targetPrice;
            ongoingTrade.Action = "Entered"
          }
          //console.log(`Buy trade initiated at ${currentClose} on ${currentEpoch}`);
        } else if (currentClose < prevLow  && currentClose <= trendPrice.s) {
          riskCheck = calculateRiskReward(currentClose,prevHigh); 
          //if(firstCandle ||  riskCheck.what==true)  {  
          if(riskCheck.what==true)  {  
            currentTradeEntry = currentClose;
            currentTradeType = "sell";
            currentTradeStartTime = currentEpoch;
            currentTradeSL = prevHigh;
            currentTradeTrail  = riskCheck.targetPrice;
            ongoingTrade.type = "sell";
            ongoingTrade.price = currentClose;
            ongoingTrade.openTime = currentEpoch;
            ongoingTrade.sl = prevHigh;
            ongoingTrade.target = riskCheck.targetPrice;
            ongoingTrade.Action = "Entered";
          }
          //console.log(`Sell trade initiated at ${currentClose} on ${currentEpoch}`);
        }
        firstCandle=false;
      }
    }

    //  MONITOR LIVE TRADE
    if (currentTradeType && ongoingTrade.Action != "Live") {
      let closeTime = convertEpochToIST(epochArray[epochArray.length - 1]);
      let priceClose = closeArray[closeArray.length - 1];
      let profit = 0;
      if(ongoingTrade.type=="sell") {
        profit = (ongoingTrade.price - priceClose) * quant;
      }
      else {
        profit = (priceClose - ongoingTrade.price) * quant;
      }
      totalProfit += profit;
      tradeHistory.push({
        type: ongoingTrade.type,
        entryTime: ongoingTrade.openTime,
        lastUpdate: closeTime,
        entryPrice: ongoingTrade.price,
        closePrice: priceClose,
        targetPrice : ongoingTrade.target,
        reward: profit,
        stoploss:  ongoingTrade.sl,
        status:ongoingTrade.Action,
      });
      // Add Recent Live Ongoing Trade
      recentTradeHistory.push({
        type: ongoingTrade.type,
        entryTime: ongoingTrade.openTime,
        lastUpdate: closeTime,
        entryPrice: ongoingTrade.price,
        closePrice: priceClose,
        targetPrice : ongoingTrade.target,
        reward: profit,
        stoploss:  ongoingTrade.sl,
        status:ongoingTrade.Action,
      });
    }

    // TRADE DETAILS
    const tradeReport = {
      instrument:param||data.instrument,
      price:{open:dayOpening,close:dayClose},
      level : trendPrice,
      totalProfit: totalProfit,
      tradeHistory: tradeHistory,
      recentTradeHistory: recentTradeHistory,
      ohlc:quoteData,
      signal:{signalhistory:signalsHistory,priceAction:PAChange,gann:GNChange,signals},
      heikenAshi:heikenAshiData
    };
    return tradeReport;

  } 
}catch(err){
  console.log(err)
}
}

export function HeikenAshiStrategyWithGANN(data, param) {
  try {
    let quoteData = validateData(data);
    let heikenAshiData = calculateHeikinAshi(data, true);
    let { lowArray, closeArray, openArray, highArray, epochArray } = heikenAshiData;

    // Strategy Variables
    const {
      quant,
      maxtrade,
    } = strategyOptions;

    const dayOpening = openArray[0];
    const dayClose = closeArray[closeArray.length - 1];

    // Gann Strategy
    let trendPrice = GANN(dayOpening);

    // Signal Variables
    let currentTradeEntry = null;
    let currentTradeType = null;
    let currentTradeStartTime = null;
    let currentTradeSL = null;
    let currentTradeTrail = null;
    let trailedSL = false;
    let totalProfit = 0;
    let firstCandle = true;
    let ongoingTrade = {};

    // Trade History
    const tradeHistory = [];
    const recentTradeHistory = [];

    // Strategy Start
    if (tradeHistory.length !== maxtrade - 1) { // SAFE CHECK
      let lastDojiIndex = -1;
      let dojiHigh = 0;
      let dojiLow = 0;

      for (let i = 1; i < lowArray.length; i++) {
        ongoingTrade.Action = "Live";
        const prevLow = lowArray[i - 1];
        const currentClose = closeArray[i];
        const prevHigh = highArray[i - 1];
        const currentEpoch = epochArray[i];

        // TRAIL OR CLOSE ACTIVE BUY TRADE
        if (currentTradeType === "buy") {
          if (currentClose > prevHigh) {
            currentTradeSL = prevLow;
            trailedSL = true;
            ongoingTrade.Action = "Trailed";
          }
          if (currentClose >= currentTradeTrail || currentClose <= currentTradeSL) {
            let priceClose = currentClose;
            const profit = (priceClose - currentTradeEntry) * quant;
            totalProfit += profit;
            tradeHistory.push({
              type: "buy",
              entryTime: currentTradeStartTime,
              closeTime: currentEpoch,
              entryPrice: currentTradeEntry,
              closePrice: priceClose,
              stoploss: currentTradeSL,
              targetPrice: currentTradeTrail,
              reward: profit,
              wasSLTrailed: trailedSL,
              status: "Closed",
            });
            if (i === (lowArray.length - 1)) {
              recentTradeHistory.push({
                type: "buy",
                entryTime: currentTradeStartTime,
                closeTime: currentEpoch,
                entryPrice: currentTradeEntry,
                closePrice: priceClose,
                stoploss: currentTradeSL,
                targetPrice: currentTradeTrail,
                reward: profit,
                wasSLTrailed: trailedSL,
                status: "Closed",
              });
            }
            currentTradeEntry = null;
            currentTradeType = null;
            currentTradeSL = null;
          }
        } 
        // TRAIL OR CLOSE ACTIVE SELL TRADE
        else if (currentTradeType === "sell") {
          if (currentClose < prevLow) {
            currentTradeSL = prevHigh;
            trailedSL = true;
            ongoingTrade.Action = "Trailed";
          }
          if (currentClose <= currentTradeTrail || currentClose >= currentTradeSL) {
            let priceClose = currentClose;
            const profit = (currentTradeEntry - priceClose) * quant;
            totalProfit += profit;
            tradeHistory.push({
              type: "sell",
              entryTime: currentTradeStartTime,
              closeTime: currentEpoch,
              entryPrice: currentTradeEntry,
              closePrice: priceClose,
              stoploss: currentTradeSL,
              targetPrice: currentTradeTrail,
              reward: profit,
              wasSLTrailed: trailedSL,
              status: "Closed",
            });
            if (i === (lowArray.length - 1)) {
              recentTradeHistory.push({
                type: "sell",
                entryTime: currentTradeStartTime,
                closeTime: currentEpoch,
                entryPrice: currentTradeEntry,
                closePrice: priceClose,
                stoploss: currentTradeSL,
                targetPrice: currentTradeTrail,
                reward: profit,
                wasSLTrailed: trailedSL,
                status: "Closed",
              });
            }
            currentTradeEntry = null;
            currentTradeType = null;
            currentTradeSL = null;
            currentTradeTrail = null;
          }
        } 
        // INITIATE NEW TRADE
        else {
          // Check for Doji candle
          if (isDojiCandle({ open: openArray[i], high: highArray[i], low: lowArray[i], close: closeArray[i] })) {
            lastDojiIndex = i;
            dojiHigh = highArray[i];
            dojiLow = lowArray[i];
          }

          // If a Doji candle was found, check subsequent candles for a buy or sell signal
          if (lastDojiIndex !== -1 && i > lastDojiIndex) {
            // Buy condition
            if (currentClose > dojiHigh) {

                currentTradeEntry = currentClose;
                currentTradeType = "buy";
                currentTradeStartTime = currentEpoch;
                currentTradeSL = dojiLow; // Stop loss at Doji low
                ongoingTrade.type = "buy";
                ongoingTrade.price = currentClose;
                ongoingTrade.openTime = currentEpoch;
                ongoingTrade.sl = dojiLow; // Stop loss at Doji low
                ongoingTrade.target = calculateFibExtensionBuy(dojiHigh,dojiLow)
                ongoingTrade.Action = "Entered";
              
            } 
            // Sell condition
            else if (currentClose < dojiLow) {

                currentTradeEntry = currentClose;
                currentTradeType = "sell";
                currentTradeStartTime = currentEpoch;
                currentTradeSL = dojiHigh; // Stop loss at Doji high
                ongoingTrade.type = "sell";
                ongoingTrade.price = currentClose;
                ongoingTrade.openTime = currentEpoch;
                ongoingTrade.sl = dojiHigh; // Stop loss at Doji high
                ongoingTrade.target = calculateFibExtensionSell(dojiHigh,dojiLow);
                ongoingTrade.Action = "Entered";
              
            }
          }
        }
        firstCandle = false;
      }

      // MONITOR LIVE TRADE
      if (currentTradeType && ongoingTrade.Action !== "Live") {
        let closeTime = convertEpochToIST(epochArray[epochArray.length - 1]);
        let priceClose = closeArray[closeArray.length - 1];
        let profit = 0;
        if (ongoingTrade.type === "sell") {
          profit = (ongoingTrade.price - priceClose) * quant;
        } else {
          profit = (priceClose - ongoingTrade.price) * quant;
        }
        totalProfit += profit;
        tradeHistory.push({
          type: ongoingTrade.type,
          entryTime: ongoingTrade.openTime,
          lastUpdate: closeTime,
          entryPrice: ongoingTrade.price,
          closePrice: priceClose,
          targetPrice: ongoingTrade.target,
          reward: profit,
          stoploss: ongoingTrade.sl,
          status: ongoingTrade.Action,
        });
        // Add Recent Live Ongoing Trade
        recentTradeHistory.push({
          type: ongoingTrade.type,
          entryTime: ongoingTrade.openTime,
          lastUpdate: closeTime,
          entryPrice: ongoingTrade.price,
          closePrice: priceClose,
          targetPrice: ongoingTrade.target,
          reward: profit,
          stoploss: ongoingTrade.sl,
          status: ongoingTrade.Action,
        });
      }

      // TRADE DETAILS
      const tradeReport = {
        instrument: param || data.instrument,
        price: { open: dayOpening, close: dayClose },
        level: trendPrice,
        totalProfit: totalProfit,
        tradeHistory: tradeHistory,
        recentTradeHistory: recentTradeHistory,
        ohlc: quoteData,
        heikenAshi: heikenAshiData
      };
      return tradeReport;

    }
  } catch (err) {
    console.log(err);
  }
}


export function calculateWilliamsRStrategy(data) {
  try {
    let period = 14;
    let ohlc = validateData(data);
    let results = [];
    let previousPercentR = null; // Store previous %R to detect crossings
    let signal = {}; // This will store the most recent signal

    for (let i = period - 1; i < ohlc.closeArray.length; i++) {
      // Calculate highest high and lowest low over the lookback period
      let highestHigh = Math.max(...ohlc.highArray.slice(i - period + 1, i + 1));
      let lowestLow = Math.min(...ohlc.lowArray.slice(i - period + 1, i + 1));
      let close = ohlc.closeArray[i];

      // Calculate Williams %R
      let percentR = ((highestHigh - close) / (highestHigh - lowestLow)) * -100;
      results.push({ percentR, epoch: ohlc.epochIST[i] });

      // Detect crossings of -70 and -30
      if (previousPercentR !== null) {
        // Cross above -70: potential Sell signal
        if (previousPercentR >= -70 && percentR < -70) {
          signal = { percent: percentR, signal: 'Sell', time: ohlc.epochIST[i] };
        }
        // Cross below -30: potential Buy signal
        if (previousPercentR <= -30 && percentR > -30) {
          signal = { percent: percentR, signal: 'Buy', time: ohlc.epochIST[i] };
        }
      }

      // Update the previous percentR for the next iteration
      previousPercentR = percentR;
    }

    return { results, signal }; // Return both the %R values and the most recent signal
  } catch (err) {
    console.log(err);
  }
}

export function calculateHeikinAshi(data,flag) {
  let heikinAshiData = [];
  try{
  let ohlc = validateData(data)
  let haOpen, haClose, haHigh, haLow;
  // Iterate through the OHLC data
  for (let i = 0; i < ohlc.openArray.length; i++) {
      let open = ohlc.openArray[i];
      let high = ohlc.highArray[i];
      let low = ohlc.lowArray[i];
      let close = ohlc.closeArray[i];
      let time = ohlc.epochIST[i];
      // Calculate HA Close
      haClose = (open + high + low + close) / 4;

      // Calculate HA Open
      if (i === 0) {
          haOpen = (open + close) / 2; // For the first bar, use (Open + Close) / 2
      } else {
          haOpen = (heikinAshiData[i - 1].haOpen + heikinAshiData[i - 1].haClose) / 2;
      }

      // Calculate HA High
      haHigh = Math.max(high, haOpen, haClose);

      // Calculate HA Low
      haLow = Math.min(low, haOpen, haClose);
      // Store the calculated Heikin-Ashi values
      heikinAshiData.push({
          haOpen,
          haHigh,
          haLow,
          haClose,
          time
      });
  }
  // Process on HeikenAshi Data
  let openArray = heikinAshiData.map(item => item.haOpen);
  let highArray = heikinAshiData.map(item => item.haHigh);
  let lowArray = heikinAshiData.map(item => item.haLow);
  let closeArray = heikinAshiData.map(item => item.haClose);
  let epochArray =  heikinAshiData.map(item => item.time);

  if(flag){
    return {lowArray:lowArray,closeArray:closeArray,openArray:openArray,highArray:highArray,epochArray:epochArray}
  }
  const dayOpening = openArray[0];
  const dayClose = closeArray[closeArray.length-1];
  
  let trendPrice = GANN(dayOpening);
  let gannSignal = (dayClose>trendPrice.b)?"Buy":(dayClose<trendPrice.s)?"Sell":"";
  let doji = findHeikenAshiDoji(heikinAshiData);
  return {candle:heikinAshiData,dojiData:doji.doji,currentDoji:doji.current,gann:trendPrice,signal:gannSignal}
}catch(err){
  console.log(err)
}
}

const strategyOptions = {
  quant: 1,
  maxtrade: 2,
  entryCondition: (currentClose, prevHigh, trendPrice) => currentClose > trendPrice.b,
  exitCondition: (currentClose, prevLow, trendPrice) => currentClose < trendPrice.s,
  calculateSLTarget: (currentClose, prevLow) => calculateRiskReward(currentClose, prevLow),
  calculateProfit: (entryPrice, closePrice, quant) => (closePrice - entryPrice) * quant,
};

function validateData(data){
  const openArray = data.open;
  const highArray = data.high;
  const lowArray = data.low;
  const closeArray = data.close;
  const epochArray = data.epoch;
  if (  lowArray.length >1 && !Array.isArray(lowArray) || !Array.isArray(closeArray) ||!Array.isArray(highArray) || !Array.isArray(epochArray) 
  || lowArray.length !== closeArray.length || lowArray.length !== highArray.length || lowArray.length !== epochArray.length
  ) {
    throw new Error("Input arrays must have the same length.");
  }else{
  return {"openArray":openArray,"highArray":highArray,"lowArray":lowArray,"closeArray":closeArray,"epochArray":epochArray,"epochIST":epochArray.map(e=>convertEpochToIST(e))}
  }
}

export function GANN(price){
  const levels = calculateGannLevels(price);
  return {
    b: levels.buy,
    s: levels.sell,
    o: price,
    buy: levels.buy,
    sell: levels.sell,
    buySl: levels.buySl,
    sellSl: levels.sellSl,
    buyTargets: levels.buyTargets,
    sellTargets: levels.sellTargets,
  }
}

function calculateFibExtensionBuy(high, low) {
  const range = high - low; // Calculate the range
  const levels = {
      level1: high + range * 0.618,  // 0.618 extension level
      level1_618: high + range * 1.618, // 1.618 extension level
      level2: high + range * 2.618, // 2.618 extension level
      level100: low // Low price
  };
  return levels.level2;
}

// Function to calculate Fibonacci 2.618 extension level for sell trades
function calculateFibExtensionSell(low, high) {
  const range = high - low; // Calculate the range
  const levels = {
      level1: high + range * 0.618,  // 0.618 extension level
      level1_618: high + range * 1.618, // 1.618 extension level
      level2: high + range * 2.618, // 2.618 extension level
      level100: low // Low price
  };
  return levels.level2;
}
