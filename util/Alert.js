// ALERTS CREATION

import { sendTelegramMessage } from "../integrations/Telegram.js";

// Only for Index API and Schedular
export async function createAlert(data,req,flag,channel) {

    try{ 
      let channelName = channel || "@tradepicsfno";
      if(data.recentTradeHistory.length >0){
        let message = "Trade Alert\n\n";
        data.recentTradeHistory.forEach((trade) => {
        const {
          type,
          entryTime,
          closeTime,
          entryPrice,
          closePrice,
          currentPrice,
          status,
          stoploss
        } = trade;
  
        message += `${req.query.instrument} : ${type} : ${status}\n`;
        if(status == "Entered")
          message += `Entry Time: ${entryTime.split(" ")[1]}\n`;
        if(status == "Closed")
        //message += `🕒 Close Time: ${closeTime.split(" ")[1]}\n`;
        message += `Entry: ${entryPrice.toFixed(2)}\n`;
        message += `SL: ${stoploss.toFixed(2)}\n`;
        message += `LTP: ${closePrice.toFixed(2)}\n`;
        //message += `Trade Status: \n\n`;
        message += `Gains: ${profit.toFixed(2)}\n\n`;
        message += `\n`;
        });
        //message += "Happy Trading! 🚀💰";
        if(flag==true)
          return message;
        let response = await sendTelegramMessage(message,channelName);
      }
    }catch(e){
      console.log(e)
    }
}

// Used for /send Nifty ALert API only
export async function tradeAlert(data,req,flag,channel) {
	if(data.tradeHistory.length >0){
	  let message = "Trade History\n\n";
		
	  data.tradeHistory.forEach((trade) => {
		const {
		  type,entryTime
		} = trade;

    //message += `Instrument: ${req.query.instrument}\n`;
    //message += `Signal Type: ${type}\n`;
    //message += `🕒 Signal Time: ${time.split(" ")[1]}\n`;
    message += `${req.query.instrument} : ${type} : ${entryTime.split(" ")[1]}\n`
	  });
    if(flag==true)
      return message;
	  //message += "Happy Trading! 🚀💰";
	  let response = await sendTelegramMessage(message,channel);
	}
}

export async function signalHistoryAlert(data,req,flag,channel) {
  // FOR GANN + 15 Minutes FOR CURRENT CANDLE
	if(data.signal && data.signal.signalhistory.length >0){
    let heikenGANN = data.heikenAshi.signal;
	  let message = "Signal History \n";
    let arr = data.signal.signalhistory;
	  arr.forEach((trade) => {
		const {
		  type,time,closePrice
		} = trade;
    message += `${req.query.instrument}` 
    if(heikenGANN)
      message +=  "  : (" + heikenGANN  + ")"
    if(data.heikenAshi.currentDoji)
      message +=  "  : " + "(D)"  
    message += "\n";
    message +=  `${time.split(" ")[1]} : ${type} : ${closePrice}\n`;
    });
    if(flag==true)
      return message;
	  //message += "Happy Trading! 🚀💰";
	  let response = await sendTelegramMessage(message,channel);
	}
  // FOr 15 Minute for PAST CANDLES
	if(data.signal && data.signal.signals.length >0){
    let arr = data.signal.signals;
	  let message = "" + req.query.instrument + " " + arr[0].time.split(" ")[0] + "\n";
	  arr.forEach((trade) => {
		const {
		  type,time,closePrice
		} = trade;
    //message += `${req.query.instrument} \n` + `${time.split(" ")[1]} : ${type} : ${closePrice}\n`
    message += `${time.split(" ")[1]} : ${type} : ${closePrice}\n`
    });
    if(flag==true)
      return message;
	  //message += "Happy Trading! 🚀💰";
	  let response = await sendTelegramMessage(message,channel);
	}
  // FOR GANN, WILLIAM, HEIKEN
  if(data.mix){
    let message = "" + req.query.instrument + "\n";
    // GANNHEIKENASHI
    if(data.mix.heikenGann)
      message+= "GANN : " + data.mix.heikenGann + "\n"
    if(data.mix.williams)
      message+= "%R : " + data.mix.williams.signal + " : " +  data.mix.williams.time.split(" ")[1] + "\n"
    if(data.mix.heikenDoji)
      message+= "DOJI : " + data.mix.heikenDoji.time.split(" ")[1] + "\n"
    let response = await sendTelegramMessage(message,channel);
  }
}

export async function signalInformationAlert(message,channel) {
	  //message += "Happy Trading! 🚀💰";
	  let response = await sendTelegramMessage(message,channel);
}

export async function patternAlert(data,type,instrument) {
  let channelName = "@tradepicsfno"
  let pattern = data[data.length-1];
  if(type==="doji" && pattern.isDoji){
      let response = await sendTelegramMessage("Doji Found in " + instrument,channelName + " at candle " + data.length-1);
  }
  if(type==="star" && pattern.isStar){
      let response = await sendTelegramMessage(pattern.type + " Found in " + instrument,channelName + " at candle " + data.length-1);
  }
}
