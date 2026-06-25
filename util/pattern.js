export function findHeikenAshiDoji(data) {
  const dojiCandles = [];
  let currentDoji;
  for (let i = 0; i < data.length; i++) {
    const candle = data[i];
    const bodySize = Math.abs(candle.haClose - candle.haOpen);
    const candleRange = candle.haHigh - candle.haLow;
    const bodyToRangeRatio = bodySize / candleRange;

    // Doji condition: Small body compared to the range
    if (bodyToRangeRatio < 0.1) {
      dojiCandles.push(candle);
      if(i==(data.length - 1))
        currentDoji=candle;
    }
  }

  return {doji:dojiCandles,current:currentDoji};
}

export function isDojiCandle(candle) {
  return Math.abs(candle.open - candle.close) <= (candle.high - candle.low) * 0.1; // Define Doji condition
}


export function patternIdentifier(data,instrument,returnData){
  try{
    if(data.open.length>2){
      const dojiPatterns = findDojiPatterns(data.open, data.high, data.low, data.close);
      const starPatterns = findMorningEveningStar(data.open, data.high, data.low, data.close);
      if(returnData){
        return {pattern:{doji:dojiPatterns,start:starPatterns}}
      }
      else{
        //patternAlert(dojiPatterns,"doji",instrument)
        //patternAlert(starPatterns,"star",instrument)
      }   
    }
  }catch(err){
    console.log(err)
  }
}

// Function to check if a single candlestick is a Doji
export function isDoji(open, high, low, close) {
  const bodySize = Math.abs(open - close);
  const totalRange = high - low;

  // Define a threshold for considering a candlestick as a Doji
  const threshold = 0.1; // You can adjust this threshold based on your criteria

  // Check if the body size is relatively small compared to the total range
  return bodySize / totalRange < threshold;
}

// Function to find Doji patterns and return the index and boolean value
export function findDojiPatterns(openValues, highValues, lowValues, closeValues) {
  const dojiPatterns = [];

  for (let i = 0; i < openValues.length; i++) {
    const open = openValues[i];
    const high = highValues[i];
    const low = lowValues[i];
    const close = closeValues[i];

    const isDojiCandle = isDoji(open, high, low, close);

    // Add an object to the result array with index and boolean value
    dojiPatterns.push({ index: i, isDoji: isDojiCandle });
  }

  return dojiPatterns;
}

// Example usage for Testing:
// const openValues = [630, 635, 640, /* ... */];
// const highValues = [640, 645, 650, /* ... */];
// const lowValues = [625, 630, 635, /* ... */];
// const closeValues = [635, 640, 645, /* ... */];

//const dojiPatterns = findDojiPatterns(openValues, highValues, lowValues, closeValues);
//console.log('Doji Patterns:', dojiPatterns);


// Function to detect Morning Star and Evening Star patterns
export function findMorningEveningStar(open, high, low, close) {
  const patternResults = [];

  for (let i = 2; i < open.length; i++) {
    const prevClose = close[i - 1];
    const prevOpen = open[i - 1];
    const prevLow = low[i - 1];
    const prevHigh = high[i - 1];

    const currentClose = close[i];
    const currentOpen = open[i];
    const currentLow = low[i];
    const currentHigh = high[i];

    const prevCandleIsBearish = prevClose < prevOpen;
    const currentCandleIsSmall = Math.abs(currentClose - currentOpen) < (prevHigh - prevLow) * 0.5;
    const currentCandleIsBullish = currentClose > currentOpen;
    const gapExists = currentOpen > prevClose && currentClose < prevOpen;

    if (prevCandleIsBearish && currentCandleIsSmall && currentCandleIsBullish && gapExists) {
      // Potential Morning Star or Evening Star pattern detected
      const patternType = currentClose > prevOpen ? 'Morning Star' : 'Evening Star';
      const patternInfo = {
        type: patternType,
        index: i,
        pattern: [
          { open: prevOpen, high: prevHigh, low: prevLow, close: prevClose },
          { open: currentOpen, high: currentHigh, low: currentLow, close: currentClose },
        ],
        isStar:true,
        lastIndex:(open.length-1)
      };
      patternResults.push(patternInfo);
    }else{
      const patternInfo = {
        index: i,       
        isStar:false,
        lastIndex:(open.length-1)
      };
      patternResults.push(patternInfo);
    }
  }

  return patternResults;
}
