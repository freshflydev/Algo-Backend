import { getPreviousDayCandleData } from "../util/HistoryData.js";
import { stocksData } from "../util/LiveFeeds.js";

export const stockDataAPI = async (req, res) => {  
    res.status(200).json(stocksData());
}

export const previousStock = async (req, res) => {  
    let instrument = req.query.instrument;
    let data = await getPreviousDayCandleData(instrument);
    res.status(200).json(data);
}