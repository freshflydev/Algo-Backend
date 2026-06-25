import { quotes } from "../service/quotes.service.js";
import { signalHistoryAlert } from "../util/Alert.js";
import { getPreviousDayCandleData } from "../util/HistoryData.js";
import { addStock,removeStock,listStock } from "../util/LiveFeeds.js"
import { addStockTrigger } from "../util/PriceAlert.js";

// Testing Signal
export async function sendSignalAert() {
	let req = {
		query :{
			instrument:"SBIN",
		}
	}
  let data = await quotes(req,false);
  let previousData = await getPreviousDayCandleData(req.query.instrument);
  await signalHistoryAlert(data,req,false);
  return data;
}


export const addStockAPI = async (req, res) => {  
  const { name } = req.params;
  if (name) {
    addStock(name.toUpperCase())
    res.status(201).json({ message: 'Stock name added successfully' });
  } else {
    res.status(400).json({ error: 'Invalid request' });
  }
}

export const priceAlert = async (req, res) => {  
  const { name,price } = req.params;
  if (name && price) {
    addStockTrigger(name.toUpperCase(),price)
    res.status(201).json({ message: 'Stock Alert added successfully' });
  } else {
    res.status(400).json({ error: 'Invalid request' });
  }
}

export const removeStockAPI = async (req, res) => {  
  const {name} = req.params;
  if (name) {
    removeStock(name.toUpperCase())
    res.status(200).json({ message: 'Stock name removed successfully' });
  } else {
    res.status(400).json({ error: 'Invalid request' });
  }
}

export const listStockAPI = async (req, res) => {  
  const nifty50StockIds = listStock();
  const hyperlinks = [];
  for (const stockId of nifty50StockIds) {
    const hyperlink = `<a target="_blank" href="price?instrument=${stockId}&store=true">${stockId}</a><br/><br/>`;
    hyperlinks.push(hyperlink);
  }
  let liTags = "";
  for (const hyperlink of hyperlinks) {
    const liTag = `${hyperlink} `;
    liTags+= liTag;
  }
  res.send(
    liTags
  );
}