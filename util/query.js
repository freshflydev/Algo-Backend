import { MCX_CRUDE_FUTURE, MCX_GOLD_FUTURE } from "../Config.js";
import { getCurrentDateInIST, getYesterdayDateInIST, isHoliday } from "./Utils.js";

export function pQRP(param){ // process-Quote-Request-Parameters
    let {instrument,type,segment,timeframe,date} = param
    let dt = date || isHoliday()?getYesterdayDateInIST():getCurrentDateInIST();
    let tf = timeframe || "15";
    let i = instrument || "SBIN";
    let it = type || "-EQ";
    let st = segment || "NSE";
    if(i == "NIFTY50" || i == "NIFTYBANK" || i == "FINNIFTY" || i == "MIDCPNIFTY" || i == "SENSEX"){
      it = "-INDEX";
    }
    if(i.includes("CRUDEOIL")){
      i += "24" + MCX_CRUDE_FUTURE;
      it = "FUT";
      st = "MCX"
    }
    if(i.includes("GOLD")){
      i+= "24" + MCX_GOLD_FUTURE;
      it = "FUT";
      st = "MCX"
    }
    let symbolName = st +':'+ i + it;
    var inp={
      "symbol":symbolName,
      "resolution":tf,
      "date_format":"1",
      "range_from":dt,
      "range_to":dt,
      "cont_flag":"1"
    }
    return inp;
}