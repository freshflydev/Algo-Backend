import {LOCAL as local} from "../Config.js"
import TelegramBot from 'node-telegram-bot-api';
import {BOT_TOKEN} from "../Config.js"
import { quotes } from '../service/quotes.service.js';
import { signalHistoryAlert } from '../util/Alert.js';
/* BOT CONFIG */
const bot = (local!=true) ? new TelegramBot(BOT_TOKEN, { polling: true }):null;

/** Telegram Integration **/
export async function sendTelegramMessage(message,channelName) {
    let CHAT_ID = channelName || "@tradespicbot"
      const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: message,
        }),
      });
  
      const data = await response.json();
      if (data.ok) {
        console.log('Alert sent successfully.');
      return 'ok'
      
      } else {
        console.log('Error sending trade alert:', data.description);
      }
    } catch (error) {
      console.log('Error sending trade alert:', error.message);
    }
}
  
  
  
    // /* TWO WAY BOT */
if(local!=true) {
    bot.on('message', (msg) => {
      const chatId = msg.chat.id;
      const messageText = msg.text;
      //let {firstname} = msg.chat;
      if (messageText === '/start') {
        bot.sendMessage(chatId, 'Welcome to Equity Trading Bot!');
        const replyMarkup = {
          keyboard: [['/index','/mcx']],
          resize_keyboard: true,
          one_time_keyboard: true,
        };
        bot.sendMessage(chatId, "Select Instrument",{ reply_markup: replyMarkup});
      }
    });
  
  
    bot.onText(/\/equity/, (msg) => {
      const chatId = msg.chat.id;
      // let stockNamesRandom = getRandomElements();
      // const replyMarkup = {
      //   keyboard: [stockNamesRandom],
      //   resize_keyboard: true,
      //   one_time_keyboard: true,
      // };
      bot.sendMessage(chatId, 'Enter Stock Name'); //,{ reply_markup: replyMarkup}
      bot.once('message', async (stockNameMsg) => {
        const stockName = stockNameMsg.text;
        // bot.sendMessage(chatId, 'Enter Date : Today or YYYY-MM-DD e.g 2023-09-28');
        // bot.once('message', async (optionMsg) => {
          // const date = optionMsg.text;
          let req = {
            query :{
              instrument:stockName,            
            }
          }
          try{
            // if(!date.includes('o'))
            //   req.query.date=date
            let backtestdata = await quotes(req.query,true)
            let message = await signalHistoryAlert(backtestdata,req,true);      
            if(backtestdata.signal.signals.length > 0)    
              bot.sendMessage(chatId, message);
            else
              bot.sendMessage(chatId, "No Trade Triggerd");
          }catch(e){
            bot.sendMessage(chatId, "No Trade Triggerd");
          }
        // });
      });
    });
  
  
    bot.onText(/\/index/, (msg) => {
      const chatId = msg.chat.id;
      const replyMarkup = {
        keyboard: [['NIFTY50', 'NIFTYBANK','FINNIFTY','MIDCPNIFTY']],
        resize_keyboard: true,
        one_time_keyboard: true,
      };
      bot.sendMessage(chatId, 'Select Index',{ reply_markup: replyMarkup} );
      bot.once('message', async (stockNameMsg) => {
        const stockName = stockNameMsg.text;
        // bot.sendMessage(chatId, 'Type Date : Today or YYYY-MM-DD e.g 2023-09-28');
        // bot.once('message', async (optionMsg) => {
          // const date = optionMsg.text;
          let req = {
            query :{
              instrument:stockName,        
              type:"-INDEX"    
            }
          }
          try{
            // if(!date.includes('o'))
            //   req.query.date=date
            let backtestdata = await quotes(req);
            let message = await signalHistoryAlert(backtestdata,req,true);          
            if(backtestdata.signal.signals.length > 0)    
              bot.sendMessage(chatId, message);
            else
              bot.sendMessage(chatId, "No Trade Triggerd");
          }catch(e){
            bot.sendMessage(chatId, "No Trade Triggerd");
          }
        // });
      });
    });
  
    bot.onText(/\/mcx/, (msg) => {
      const chatId = msg.chat.id;
      const replyMarkup = {
        keyboard: [['CRUDEOIL','GOLD']],
        resize_keyboard: true,
        one_time_keyboard: true,
      };
      bot.sendMessage(chatId, 'Select Commodity',{ reply_markup: replyMarkup} );
      bot.once('message', async(stockNameMsg) => {
        const stockName = stockNameMsg.text;
        // bot.sendMessage(chatId, 'Type Date : Today or YYYY-MM-DD e.g 2023-09-28');
        // bot.sendMessage(chatId, 'e.g 2023-09-28');
        // bot.once('message', async (optionMsg) => {
          // const date = optionMsg.text;
          let req = {
            query :{
              instrument:stockName,        
              type:"FUT",
              segment:"MCX"
            }
          }        
          try{
            // if(!date.includes('o'))
            //   req.query.date=date
            let backtestdata = await quotes(req.query,true)
            let message = await signalHistoryAlert(backtestdata,req,true);        
            if(backtestdata.signal.signals.length > 0)    
              bot.sendMessage(chatId, message);
            else
              bot.sendMessage(chatId, "No Trade Triggerd");
          }catch(e){
            bot.sendMessage(chatId, "No Trade Triggerd");
          }
        // });
      });
    });
  
    // Handle conflict errors (HTTP 409)
    bot.on('polling_error', (error) => {
      if (error.code === 'ETELEGRAM') {
        // Handle the conflict error here
        console.error('Bot instance conflict detected. Terminating...');
        // Gracefully terminate the bot
        //process.exit(1);
      } else {
        console.error('An error occurred:' + error);
      }
    });
}