import { quotesCandleData } from "../service/candle.service.js";
import { getPreviousDayCandleData } from "../util/HistoryData.js";
import { calculateHeikinAshi, calculateWilliamsRStrategy, FifteenMinuteStrategyWithGANN } from "../util/Strategy.js";
import { patternIdentifier } from "../util/pattern.js";
import {combinePreviousTodayCandle} from "../util/Utils.js"
import { sendTelegramMessage } from "../integrations/Telegram.js";
import { signalHistoryAlert } from "../util/Alert.js";

export const priceAPI = async (req, res) => {  
    try{
        let data = await quotesCandleData(req);
        let backtestdata = FifteenMinuteStrategyWithGANN(data);
        res.status(200).json({data:backtestdata});
      }catch(e){
        res.status(500).json(e);
    }
}

export const strategyAPI = async (req, res) => {  
  try{
      let data = await quotesCandleData(req);
      // let pattern = patternIdentifier(data,param.instrument,true);
      // data.pattern = pattern;
      //let previous = await getPreviousDayCandleData(req.query.instrument);
      //let combineData = combinePreviousTodayCandle(data,previous);
      let williams = calculateWilliamsRStrategy(data);
      // HeikenAshiRequired Previous Day Data
      let heikenAshi = calculateHeikinAshi(data)
      let mix = {instrument:req.query.instrument,williams:williams.signal,heikenDoji:heikenAshi.dojiData[heikenAshi.dojiData.length-1],heikenGann:heikenAshi.signal,gann:heikenAshi.gann};
      data.mix = mix;
      signalHistoryAlert(data,req);
      res.status(200).json(mix);
    }catch(e){
      res.status(500).json(e);
  }
}