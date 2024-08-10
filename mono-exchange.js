const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const moment = require("moment");
require("dotenv").config();

// Replace <YOUR_API_TOKEN> with your obtained API token
const TOKEN = process.env.TELEGRAM_API_TOKEN;
let chatIds = [];
const bot = new TelegramBot(TOKEN, { polling: true });

let cachedExchangeRates = {};

bot.onText("/start", async (msg) => {
  const chatId = msg.chat.id;
  if (!chatIds.includes(chatId)) {
    chatIds.push(chatId);
  }
  startFetchingRates(msg);

  bot.sendMessage(chatId, "Bot reset. Use /rates to fetch currency rates.");
});

bot.onText("/rates", async (msg) => {
  const chatId = msg.chat.id;

  // Initialize the cache for this user if it doesn't exist
  if (!cachedExchangeRates[chatId]) {
    cachedExchangeRates[chatId] = {};
  }

  // Calculate the time difference between now and when the rates were last fetched
  const now = moment().unix();
  const timeDiff = now - (cachedExchangeRates[chatId].timestamp || 0);

  if (!cachedExchangeRates[chatId].data && timeDiff >= 15 * 60) {
    // If there are no cached rates and they are older than 15 minutes, fetch new ones
    const rates = await fetchExchangeRates(chatId);
    if (!rates || rates.length === 0) {
      bot.sendMessage(
        chatId,
        "Failed to fetch exchange rates. Please try again later."
      );
      return;
    }
    cachedExchangeRates[chatId] = { timestamp: moment().unix(), data: rates };
  } else if (timeDiff < 15 * 60) {
    // If cached rates are less than 15 minutes old, use them
    const filteredRates = cachedExchangeRates[chatId].data.filter(
      (rate) =>
        (rate.currencyCodeA === 840 && rate.currencyCodeB === 980) ||
        (rate.currencyCodeA === 978 && rate.currencyCodeB === 980)
    );
  }

  // Filter out the unwanted currency pairs
  const filteredRates = cachedExchangeRates[chatId].data.filter(
    (rate) =>
      (rate.currencyCodeA === 840 && rate.currencyCodeB === 980) ||
      (rate.currencyCodeA === 978 && rate.currencyCodeB === 980)
  );

  // Format the rates to have two decimal places and send them in a formatted message with emojis
  const rateMessage = filteredRates
    .map((rate) => {
      let currencySymbol = "";
      if (rate.currencyCodeA === 840 && rate.currencyCodeB === 980) {
        currencySymbol = "🇺🇸"; // Unicode for the US flag
      } else if (rate.currencyCodeA === 978 && rate.currencyCodeB === 980) {
        currencySymbol = "🇪🇺"; // Unicode for the EU flag
      }
      const formattedRateBuy = parseFloat(rate.rateBuy).toFixed(2);
      let formattedRateSell = parseFloat(rate.rateSell).toFixed(2);
      if (formattedRateSell.toString().split(".")[1]?.length > 2) {
        formattedRateSell = rate.rateSell.toFixed(2);
      }
      return `${currencySymbol} ${formattedRateBuy} / ${formattedRateSell}`;
    })
    .join("\n");

  const date = moment().utcOffset("+03:00").format("DD/MM/YYYY");
  const formattedDate = date.split(" ")[0]; // Extract only the date part

  bot.sendMessage(
    chatId,
    `Here are the latest currency rates as of ${formattedDate}:\n${rateMessage}`
  );
});

// Function to fetch exchange rates from Monobank API
async function fetchExchangeRates() {
  try {
    console.log("Fetching exchange rates from Monobank API...");
    const response = await axios.get("https://api.monobank.ua/bank/currency");

    if (response.status === 429) {
      console.error("Too many requests to the API. Please try again later.");
      return null;
    }

    if (response.status !== 200) {
      console.error(
        `Failed to fetch exchange rates from Monobank API: ${response.statusText}`
      );
      return null;
    }

    const data = response.data;
    console.log("Fetched exchange rates:", data); // Log the fetched data for debugging
    return data;
  } catch (error) {
    console.error("Error fetching exchange rates from Monobank API:", error);
    return null;
  }
}

// Function to schedule the rate fetching every 15 minutes
const startFetchingRates = () => {
  timer = setInterval(async () => {
    const now = moment().unix();
    let cachedTimestamp;
    let filteredRates;

    // Loop through all users and fetch rates for each
    for (let chatId of chatIds) {
      if (cachedExchangeRates[chatId]) {
        cachedTimestamp = cachedExchangeRates[chatId].timestamp;
        filteredRates = cachedExchangeRates[chatId].data.filter(
          (rate) =>
            (rate.currencyCodeA === 840 && rate.currencyCodeB === 980) ||
            (rate.currencyCodeA === 978 && rate.currencyCodeB === 980)
        );
      } else {
        console.log(`No cached rates available for chatId ${chatId}`);
        filteredRates = [];
      }

      if (cachedTimestamp && cachedTimestamp < now - 15 * 60 * 1000) {
        const newRates = await fetchExchangeRates(chatId);
        let ratesChanged = false;

        for (let i = 0; i < newRates.length; i++) {
          for (let j = 0; j < filteredRates.length; j++) {
            if (
              newRates[i].currencyCodeA === filteredRates[j].currencyCodeA &&
              newRates[i].currencyCodeB === filteredRates[j].currencyCodeB
            ) {
              // Compare rates for the same currency pair to see if they have changed
              if (
                newRates[i].rateBuy !== filteredRates[j].rateBuy ||
                newRates[i].rateSell !== filteredRates[j].rateSell
              ) {
                bot.sendMessage(chatId, "Exchange rates have changed for you!");
                console.log("Rates have changed:", newRates);
                ratesChanged = true;
              }
              break;
            }
          }
        }

        if (ratesChanged) {
          cachedExchangeRates[chatId] = { timestamp: now, data: newRates };
        } else {
          bot.sendMessage(chatId, "Exchange rates remain the same for you.");
        }
      }
    }
  }, 15 * 60 * 1000); // Run every 15 minutes
};
