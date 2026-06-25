import { quotesCandleData } from "../service/candle.service.js";
import { candleDataTransform } from "../util/candle.js";
import { listStock, quotesFromMemory, stocksData } from "../util/LiveFeeds.js";
import { FifteenMinuteStrategyWithGANN } from "../util/Strategy.js";


export async function quotes(param,memory) {
    if(memory || listStock().includes(param.instrument)){
      const data = quotesFromMemory(param.instrument);
      if(false && data.length!=0){
        let candleData = candleDataTransform(data)
        //patternIdentifier(candleData,param);
        let backtestdata = FifteenMinuteStrategyWithGANN(candleData,param.instrument);
        return backtestdata;
      }
    }else{
      //let data = candleDataTransform(await historyQuotes(pQRP(param)))
      //patternIdentifier(data,param.instrument);
      let data = await quotesCandleData(param);
      let backtestdata = FifteenMinuteStrategyWithGANN(data,param.instrument);
      return backtestdata;
    }
}