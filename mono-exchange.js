const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const moment = require("moment");
require("dotenv").config();

// Replace <YOUR_API_TOKEN> with your obtained API token
const TOKEN = process.env.TELEGRAM_API_TOKEN;
const bot = new TelegramBot(TOKEN, { polling: true });

let chatIds = [];
let cachedExchangeRates = { data: [], timestamp: null }; // Global cache for all users
let lastFetchTime = null;

// Helper function to get current timestamp
function getCurrentTimestamp() {
  return moment().format("YYYY-MM-DD HH:mm:ss");
}

bot.onText("/start", async (msg) => {
  const chatId = msg.chat.id;
  if (!chatIds.includes(chatId)) {
    chatIds.push(chatId);
  }
  bot.sendMessage(chatId, "Bot reset. Use /rates to fetch currency rates.");
});

bot.onText("/rates", async (msg) => {
  const chatId = msg.chat.id;

  // Calculate the time difference between now and when the rates were last fetched
  const now = moment().unix();

  if (lastFetchTime && now - lastFetchTime < 15 * 60) {
    // Use global cached data if it is less than 15 minutes old
    const filteredRates = filterRates(cachedExchangeRates.data);
    sendRatesMessage(chatId, filteredRates, lastFetchTime);
  } else {
    // Fetch new rates and update global cache
    const rates = await fetchExchangeRates();
    if (!rates || rates.length === 0) {
      bot.sendMessage(
        chatId,
        "Failed to fetch exchange rates. Please try again later."
      );
      return;
    }

    // Update global cache
    cachedExchangeRates = { timestamp: now, data: rates };
    lastFetchTime = now;

    const filteredRates = filterRates(rates);
    sendRatesMessage(chatId, filteredRates, now);
  }
});

// Function to fetch exchange rates from Monobank API
async function fetchExchangeRates() {
  try {
    console.log(
      `[${getCurrentTimestamp()}] Fetching exchange rates from Monobank API...`
    );
    const response = await axios.get("https://api.monobank.ua/bank/currency");

    if (response.status === 429) {
      console.error(
        `[${getCurrentTimestamp()}] Too many requests to the API. Please try again later.`
      );
      return null;
    }

    if (response.status !== 200) {
      console.error(
        `[${getCurrentTimestamp()}] Failed to fetch exchange rates from Monobank API: ${
          response.statusText
        }`
      );
      return null;
    }

    const data = response.data;
    console.log(`[${getCurrentTimestamp()}] Fetched exchange rates:`, data); // Log the fetched data for debugging
    return data;
  } catch (error) {
    console.error(
      `[${getCurrentTimestamp()}] Error fetching exchange rates from Monobank API:`,
      error
    );
    return null;
  }
}

// Function to filter out unwanted currency pairs
function filterRates(rates) {
  return rates
    ? rates.filter(
        (rate) =>
          (rate.currencyCodeA === 840 && rate.currencyCodeB === 980) ||
          (rate.currencyCodeA === 978 && rate.currencyCodeB === 980)
      )
    : [];
}

// Function to compare rates
function ratesHaveChanged(oldRates, newRates) {
  if (oldRates.length !== newRates.length) {
    return true;
  }

  for (let i = 0; i < oldRates.length; i++) {
    const oldRate = oldRates[i];
    const newRate = newRates.find(
      (rate) =>
        rate.currencyCodeA === oldRate.currencyCodeA &&
        rate.currencyCodeB === oldRate.currencyCodeB
    );

    if (
      !newRate ||
      oldRate.rateBuy !== newRate.rateBuy ||
      oldRate.rateSell !== newRate.rateSell
    ) {
      return true;
    }
  }

  return false;
}

// Function to format and send the rates message
function sendRatesMessage(chatId, rates, timestamp) {
  const rateMessage = rates
    .map((rate) => {
      let currencySymbol = "";
      if (rate.currencyCodeA === 840 && rate.currencyCodeB === 980) {
        currencySymbol = "🇺🇸"; // Unicode for the US flag
      } else if (rate.currencyCodeA === 978 && rate.currencyCodeB === 980) {
        currencySymbol = "🇪🇺"; // Unicode for the EU flag
      }
      const formattedRateBuy = parseFloat(rate.rateBuy).toFixed(2);
      const formattedRateSell = parseFloat(rate.rateSell).toFixed(2);
      return `${currencySymbol} ${formattedRateBuy} / ${formattedRateSell}`;
    })
    .join("\n");

  const formattedDate = moment
    .unix(timestamp)
    .utcOffset("+03:00")
    .format("DD/MM/YYYY");

  bot.sendMessage(
    chatId,
    `Here are the latest currency rates as of ${formattedDate}:\n${rateMessage}`
  );
}

// Function to schedule the rate fetching every 15 minutes
const startFetchingRates = () => {
  setInterval(async () => {
    const now = moment().unix();

    // Fetch new rates if the cache is older than 15 minutes or never fetched
    if (!lastFetchTime || now - lastFetchTime >= 15 * 60) {
      console.log(
        `[${getCurrentTimestamp()}] Fetching fresh exchange rates...`
      );
      const newRates = await fetchExchangeRates();
      if (newRates && Object.keys(newRates).length > 0) {
        if (ratesHaveChanged(cachedExchangeRates.data, newRates)) {
          // Update global cache
          cachedExchangeRates = { timestamp: now, data: newRates };
          lastFetchTime = now;

          // Notify all users of the updated rates
          chatIds.forEach((chatId) => {
            const filteredRates = filterRates(newRates);
            sendRatesMessage(chatId, filteredRates, now);
          });
        } else {
          console.log(`[${getCurrentTimestamp()}] Rates have not changed.`);
        }
      } else {
        console.error(
          `[${getCurrentTimestamp()}] Failed to fetch new exchange rates.`
        );
      }
    } else {
      console.log(`[${getCurrentTimestamp()}] Using cached exchange rates.`);
    }
  }, 15 * 60 * 1000); // Run every 15 minutes
};
startFetchingRates();
