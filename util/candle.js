export function candleDataTransform(candles){
    let openIndex = 1;
    let highIndex = 2;
    let lowIndex = 3;
    let closeIndex = 4;
    let timeIndex = 0;
    let volIndex = 5;
    try{
        let data = candles.candles
        let response = null;
        response = {open: data.map(subArray => subArray[openIndex]), high:data.map(subArray => subArray[highIndex]), low: data.map(subArray => subArray[lowIndex]), close: data.map(subArray => subArray[closeIndex]), epoch:data.map(subArray => subArray[timeIndex]), volume:  data.map(subArray => subArray[volIndex])};
        return response;
    } catch(error){
        return {};
    }
}