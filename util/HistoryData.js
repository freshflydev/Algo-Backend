import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {getYesterdayDateInIST} from "./Utils.js"
import { createRequestQuery, getHistoryQuotes, transformCandel } from '../service/candle.service.js';

// Convert 'import.meta.url' to directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// File where candle data will be stored
const DATA_FILE = path.join(__dirname, 'candleData.json');
// File to track the last date the cleanup ran
const LAST_CLEAN_DATE_FILE = path.join(__dirname, 'lastCleanDate.txt');

// In-memory storage for candle data
let candleData = {};

// Load candle data from file on application start
export function loadCandleDataFromFile() {
    if (fs.existsSync(DATA_FILE)) {
        const data = fs.readFileSync(DATA_FILE, 'utf-8');
        try{
            candleData = JSON.parse(data);
        }catch(err){
            clearCandleData();
        }
    } else {
        candleData = {};
    }

    // Check if we need to run the clean-up
    const lastCleanedDate = getLastCleanedDate();
    const today = getTodayDateString();
    if (lastCleanedDate !== today) {
        cleanOldData(); // Clean up data from previous day if it's a new day
        saveLastCleanedDate(today); // Update the last cleaned date
    }
}

// Save candle data to file
function saveCandleDataToFile() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(candleData, null, 2));
}

// Function to retrieve candle data for the previous day for a specific stock
export async function getPreviousDayCandleData(stockSymbol) {
    try{
        const yesterday = getYesterdayDateString();
        if (candleData[stockSymbol] && candleData[stockSymbol][yesterday]) {
            return candleData[stockSymbol][yesterday];
        }else{
            // Fetch Data for Previous Day
            let param = {
                "instrument": stockSymbol, 
                "type":"",
                "segment": "NSE",
                "timeframe": 15,
                "date": getYesterdayDateInIST()
            }  
            let query = createRequestQuery(param);
            let historyQuote = await getHistoryQuotes(query);
            let data = transformCandel(historyQuote)
            storePreviousDayCandleData(stockSymbol,data);
            return data;
        }
    }catch(err){
        console.log(err)
        throw new Error(err)
    }
}

// Function to store candle data for a stock for the previous day if not already present
export function storePreviousDayCandleData(stockSymbol, data) {
    const yesterday = getYesterdayDateString();
    
    if (!candleData[stockSymbol]) {
        candleData[stockSymbol] = {};
    }

    if (!candleData[stockSymbol][yesterday]) {
        candleData[stockSymbol][yesterday] = data;
        saveCandleDataToFile();
        console.log(`Candle data for ${stockSymbol} on ${yesterday} stored successfully.`);
    } else {
        console.log(`Candle data for ${stockSymbol} on ${yesterday} already exists.`);
    }
}

// Function to clear all candle data (in-memory and from file)
export function clearCandleData() {
    candleData = {};
    if (fs.existsSync(DATA_FILE)) {
        fs.unlinkSync(DATA_FILE);
    }
    console.log("All candle data cleared.");
}

// Function to clean old data and keep only the previous day's data
function cleanOldData() {
    const yesterday = getYesterdayDateString();

    for (let stockSymbol in candleData) {
        for (let date in candleData[stockSymbol]) {
            if (date !== yesterday) {
                console.log(`Removing old data for ${stockSymbol} on ${date}`);
                delete candleData[stockSymbol][date];
            }
        }

        // Remove stock symbol if there is no data left for the previous day
        if (Object.keys(candleData[stockSymbol]).length === 0) {
            delete candleData[stockSymbol];
        }
    }

    saveCandleDataToFile(); // Save cleaned data to file
}

// Utility function to get today's date string in YYYY-MM-DD format
function getTodayDateString() {
    const today = new Date();
    return today.toISOString().split('T')[0];
}

// Utility function to get yesterday's date string in YYYY-MM-DD format
function getYesterdayDateString() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString().split('T')[0];
}

// Utility function to load the last cleaned date from file
function getLastCleanedDate() {
    if (fs.existsSync(LAST_CLEAN_DATE_FILE)) {
        return fs.readFileSync(LAST_CLEAN_DATE_FILE, 'utf-8').trim();
    }
    return null; // No last cleaned date available
}

// Utility function to save the last cleaned date to file
function saveLastCleanedDate(dateString) {
    fs.writeFileSync(LAST_CLEAN_DATE_FILE, dateString);
}
