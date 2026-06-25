import moment from 'moment-timezone';
import schedule from 'node-schedule';
import {isGANNDate, isHoliday, SampleWSMessage} from '../util/Utils.js'
import {quotes} from '../service/quotes.service.js'
import {calculateOHLC,listStock,stocksData} from "../util/LiveFeeds.js"
import { signalHistoryAlert, signalInformationAlert } from '../util/Alert.js';
import { LIVEFEED } from '../Config.js';

moment.tz.setDefault('Asia/Kolkata');

// SCHEDULERS
let isDailySchedulerEnabled = false;
let isEquitySchedulerEnabled = false;
let isIndexSchedulerEnabled = true;
let isMCXSchedulerEnabled = true;
let isPreMarketSchedulerEnabled = true;
let isPostMarketSchedulerEnabled = true;

let dailyJob = null;
let equityJob = null;
let indexJob = null;
let mcxJob = null;
let preJob = null;
let PostJob = null;

export function enableScheduler(){
    try{
      isDailySchedulerEnabled = true;
      configureDailySchedulerJob();
      isEquitySchedulerEnabled = true;
      configureEquitySchedulerJob();
      isIndexSchedulerEnabled = true;
      configureIndexSchedulerJob();
      isMCXSchedulerEnabled = true;
      configureMCXSchedulerJob();
    }catch(e){

      console.log("Failed to Start Scheduler")
    }
    let status= {daily:isDailySchedulerEnabled ,mcx: isMCXSchedulerEnabled, equity: isEquitySchedulerEnabled, index : isIndexSchedulerEnabled, live:"enabled"}  
    return status;
}

export function disableScheduler(){
    try{
      isEquitySchedulerEnabled = false;
      configureEquitySchedulerJob();
      isIndexSchedulerEnabled = false;
      configureIndexSchedulerJob();
      isMCXSchedulerEnabled = false;
      configureMCXSchedulerJob();
    }catch(e){
      console.log("Failed to Disable Scheduler")
    }
    let status= {mcx: isMCXSchedulerEnabled, equity: isEquitySchedulerEnabled, index : isIndexSchedulerEnabled, live:"enabled"}  
    return status;
}

export function configureDailySchedulerJob() {
  if (dailyJob) {
    dailyJob.cancel(); // Cancel the existing job if it exists
    dailyJob = null;
  }

  if (isIndexSchedulerEnabled) {
    dailyJob = schedule.scheduleJob('0 9 * * *', () => {
      console.log('Running job at 9 AM daily');
      // Check if Market Holiday
      if(isHoliday()){
        signalInformationAlert("Today Market Holiday")
      }else{
         signalInformationAlert("Have a Great Trading Day");
      }
      if(isGANNDate()){
        signalInformationAlert("Today GANN Day")
      }
    });
  }
}
export function configureIndexSchedulerJob() {
    if (indexJob) {
      indexJob.cancel(); // Cancel the existing job if it exists
      indexJob = null;
    }
  
    if (isIndexSchedulerEnabled) {
      const startTime = moment.tz('9:00 AM', 'h:mm A', 'Asia/Kolkata');
      const endTime = moment.tz('3:30 PM', 'h:mm A', 'Asia/Kolkata');
  
      indexJob = schedule.scheduleJob('*/15 * * * *', () => {
        const currentTime = moment();
        //console.log("Index Job Run")
        if (currentTime.isBetween(startTime, endTime) && !isHoliday(currentTime)) {
          console.log('Scheduled INDEX job running at', currentTime.format('YYYY-MM-DD HH:mm:ss'));
          // Add your task logic here
          //let data =  await checkStockPriceAndAlert();
          
          let fnoStock = ["NIFTY50","NIFTYBANK"]; 
          let webSAlert = {type:"index",data:[]};
          fnoStock.forEach(async(item)=>{
            let req = {
              query :{
                instrument:'NIFTY50'
              }
            };
            req.query.instrument = item;
            let backtestdata = await quotes(req);      
            let channelName = "@tradepicksindex";
            if(item == "FINNIFTY" || item == "MIDCPNIFTY") {
              channelName = "@tradepicksmid";
            }
            //let data = await createAlert(backtestdata,req,false,channelName);
            //let signal = await createSignalAlert(backtestdata,req,false,channelName);
            let signals = await signalHistoryAlert(backtestdata,req,false,channelName);
            webSAlert.data.push(backtestdata);
            //await setTimeout(5000);
            await new Promise(resolve => setTimeout(resolve, 3000));
          })
          SampleWSMessage(webSAlert)
        } else {
            console.log("Index Market Closed !")
          isIndexSchedulerEnabled = false;
        }
      });
  
      console.log('Scheduler Index enabled.');
    } else {
      console.log('Scheduler Index disabled.');
    }
}

export function configureMCXSchedulerJob() {
    if (mcxJob) {
      mcxJob.cancel(); // Cancel the existing job if it exists
      mcxJob = null;
    }
  
    if (isMCXSchedulerEnabled) {
      const startTime = moment.tz('9:00 AM', 'h:mm A', 'Asia/Kolkata');
      const endTime = moment.tz('11:30 PM', 'h:mm A', 'Asia/Kolkata');
  
      mcxJob = schedule.scheduleJob('*/15 * * * *', async () => {
        const currentTime = moment();
        //console.log("MCX Job Run")
        if (currentTime.isBetween(startTime, endTime) && !isHoliday(currentTime)) {
          console.log('Scheduled MCX job running at', currentTime.format('YYYY-MM-DD HH:mm:ss'));
          let webSAlert = {type:"mcx",data:[]};
          // Add your task logic here
          //let data =  await checkStockPriceAndAlert();
          // MCX:CRUDEOIL23OCTFUT
          let mcxStock = ["CRUDEOIL"];
  
          mcxStock.forEach(async(item)=>{
            let req = {
              query :{
                instrument: item,        
                type:"FUT",
                segment:"MCX"
              }
            };       
            let backtestdata = await quotes(req);      
            //let data = await createAndAlert(backtestdata,req,false,"@tradepicksmcx");
            //let data = await createAlert(backtestdata,req,false,"@tradepicksmcx");
            let data1 = await signalHistoryAlert(backtestdata,req,false,"@tradepicksmcx");
            //let signal = await createSignalAlert(backtestdata,req,false,"@tradepicksmcx");
            webSAlert.data.push(backtestdata);
            await new Promise(resolve => setTimeout(resolve, 3000));
            })
          SampleWSMessage(webSAlert)
        }
        else {
          console.log("MCX Market Closed !")
        }
      });
  
      console.log('Scheduler MCX enabled.');
    } else {
      console.log('Scheduler MCX disabled.');
    }
}

export function configureEquitySchedulerJob() {
    if (equityJob) {
      equityJob.cancel(); // Cancel the existing job if it exists
      equityJob = null;
    }
  
    if (isEquitySchedulerEnabled) {
      const startTime = moment.tz('9:00 AM', 'h:mm A', 'Asia/Kolkata');
      const endTime = moment.tz('3:30 PM', 'h:mm A', 'Asia/Kolkata');
  
      equityJob = schedule.scheduleJob('*/15 * * * *', async () => {
        //console.log("Equity Job Run")
        const currentTime = moment();
        if (currentTime.isBetween(startTime, endTime) && !isHoliday(currentTime)) {
          console.log('Scheduled job running at', currentTime.format('YYYY-MM-DD HH:mm:ss'));
  
          let channelName = ""
          // Based on 15 Minute Quote API
          //quotesData();
          let webSAlert = {type:"equity",data:[]};
          // Based on RealTime Websocket Quote Data
          for (const stockSymbol of listStock()) {
            if(LIVEFEED)
              calculateOHLC(stockSymbol);
            let req = {
              query :{
                instrument: stockSymbol
              }
            };
            let backtestdata = await quotes(req,false)
            let signals = await signalHistoryAlert(backtestdata,req,false,channelName);
            webSAlert.data.push(backtestdata);
          }
          SampleWSMessage(webSAlert)
  
        } else {
          console.log("Equity Market Closed !")
          isEquitySchedulerEnabled = false;
        }
      });
  
      console.log('Scheduler Equity enabled.');
    } else {
      console.log('Scheduler Equity disabled.');
    }
}


// Schedule a task to run at 9:15 AM IST every day
const preMarketJob = schedule.scheduleJob({ hour: 9, minute: 15, tz: 'Asia/Kolkata' }, () => {
  console.log("Pre-market function started at 9:15 AM IST");

  // Start the pre-market task
  //preMarketTask();

  // Execute the final task after 59 seconds (just before the 1-minute mark)
  setTimeout(() => {
    //finalTask();
    console.log("Pre-market function ended after 1 minute.");
  }, 59000); // 59 seconds timeout to execute final task before 1 minute ends
});