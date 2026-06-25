import { pQRP } from "../util/query.js"
import { historyQuotes } from "../service/broker.service.js"
import { candleDataTransform } from "../util/candle.js"


export async function quotesCandleData(req) {
    let param = requestToParam(req)
    let query = createRequestQuery(param)
    let historyQuote = await getHistoryQuotes(query);
    let data = transformCandel(historyQuote)
    data.instrument = param.instrument;
    return data;
}

export function requestToParam(req){
    let {instrument,type,date,segment,timeframe} = req.query;
    let param = {
        "instrument": instrument || "FINNIFTY", 
        "type":type || "",
        "segment":segment || "NSE",
        "timeframe":timeframe || 15,
        "date":date || ""
    }  
    return param;
}

export function createRequestQuery(param){
    return pQRP(param);
}

export async function getHistoryQuotes(query){
    return await historyQuotes(query);
}

export function transformCandel(historyQuote){
    return candleDataTransform(historyQuote);
}