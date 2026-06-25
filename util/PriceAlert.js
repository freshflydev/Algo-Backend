import fs from 'fs';
import path from 'path';

// Define the path to the file that stores the stock triggers
const FILE_PATH = path.resolve('stock_triggers.json');

// Helper function to read the stock triggers from the file
function readTriggersFromFile() {
  if (fs.existsSync(FILE_PATH)) {
    const data = fs.readFileSync(FILE_PATH, 'utf-8');
    return JSON.parse(data);
  }
  return [];
}

// Helper function to write the stock triggers to the file
function writeTriggersToFile(triggers) {
  fs.writeFileSync(FILE_PATH, JSON.stringify(triggers, null, 2));
}

// Function to add a stock price trigger
export function addStockTrigger(stockSymbol, targetPrice) {
  let triggers = readTriggersFromFile();

  // Check if the trigger already exists
  const existingTrigger = triggers.find(trigger => trigger.stockSymbol === stockSymbol && trigger.targetPrice === targetPrice);

  if (!existingTrigger) {
    // Add new stock trigger
    triggers.push({ stockSymbol, targetPrice, triggered: false });
    writeTriggersToFile(triggers);
    console.log(`Added stock trigger for ${stockSymbol} at target price: ${targetPrice}`);
  } else {
    console.log(`Stock trigger for ${stockSymbol} at price ${targetPrice} already exists.`);
  }
}

// Function to check if any triggers should be triggered based on the current price
export function checkStockTriggers(currentPrices) {
  let triggers = readTriggersFromFile();
  let remainingTriggers = [];

  triggers.forEach(trigger => {
    const { stockSymbol, targetPrice, triggered } = trigger;

    // Check if the current stock price meets or exceeds the target price
    if (currentPrices[stockSymbol] >= targetPrice && !triggered) {
      console.log(`Trigger Alert: ${stockSymbol} has reached the target price of ${targetPrice}`);
      // Mark the trigger as triggered (could remove here if preferred)
    } else {
      // Keep the untriggered alerts
      remainingTriggers.push(trigger);
    }
  });

  // Save the remaining triggers to the file (after removing the triggered ones)
  writeTriggersToFile(remainingTriggers);
}

// Example usage:
// Adding stock price triggers
//addStockTrigger('AAPL', 150);
//addStockTrigger('GOOGL', 2800);

// Mock current stock prices (this would come from an API in a real-world scenario)
const currentStockPrices = {
  'AAPL': 155,
  'GOOGL': 2700
};

// Checking if any stock triggers should be fired
//checkStockTriggers(currentStockPrices);