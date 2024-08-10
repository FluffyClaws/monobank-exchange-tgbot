const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const moment = require("moment");
require("dotenv").config();

// Replace <YOUR_API_TOKEN> with your obtained API token
const TOKEN = process.env.TELEGRAM_API_TOKEN;
const chatId = process.env.CHAT_ID; // Replace with the desired channel ID or user ID
let timer;
const bot = new TelegramBot(TOKEN, { polling: true });

// Cache the exchange rates for 5 minutes (in seconds)
let cachedExchangeRates = null;
let isRatesFetched = false; // Flag to track if rates are fetched

bot.onText("/start", async (msg) => {
  clearTimeout(timer); // Clear any previous timer before starting a new one

  // Reset the cache and flag when /start is called
  cachedExchangeRates = null;
  isRatesFetched = false;

  bot.sendMessage(chatId, "Bot reset. Use /rates to fetch currency rates.");
});

bot.onText("/rates", async (msg) => {
  const rates = await fetchExchangeRates();
  if (!rates || rates.length === 0) {
    bot.sendMessage(
      chatId,
      "Failed to fetch exchange rates. Please try again later."
    );
    return;
  }
  cachedExchangeRates = { timestamp: moment().unix(), data: rates };
  isRatesFetched = true;

  // Filter out the unwanted currency pairs
  const filteredRates = rates.filter(
    (rate) =>
      (rate.currencyCodeA === 840 && rate.currencyCodeB === 980) ||
      (rate.currencyCodeA === 978 && rate.currencyCodeB === 980)
  );

  // Format the rates to have two decimal places and send them in a formatted message with emojis
  const rateMessage = filteredRates
    .map((rate) => {
      let currencySymbol = "";
      if (rate.currencyCodeA === 840 && rate.currencyCodeB === 980) {
        currencySymbol = "🇺🇸"; // Unicode for the United States flag emoji
      } else if (rate.currencyCodeA === 978 && rate.currencyCodeB === 980) {
        currencySymbol = "🇪🇺"; // Unicode for the European Union flag emoji
      }
      const formattedRateBuy = parseFloat(rate.rateBuy).toFixed(2);
      let formattedRateSell = parseFloat(rate.rateSell).toFixed(2);
      // If the sell rate has more than two decimal places, reduce it to two without rounding
      if (formattedRateSell.toString().split(".")[1]?.length > 2) {
        formattedRateSell = parseFloat(rate.rateSell.toFixed(2)).toFixed(2);
      }
      return `${currencySymbol} ${formattedRateBuy} / ${formattedRateSell}`;
    })
    .join("\n"); // Use newline to format the message nicely

  const date = moment().utcOffset("+03:00").format("DD/MM/YYYY");
  // Remove time from the date-time string
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
    const newRates = await fetchExchangeRates();
    if (newRates && isRatesFetched) {
      // Check if rates have changed
      let ratesChanged = false;
      for (let i = 0; i < newRates.length; i++) {
        for (let j = 0; j < cachedExchangeRates.data.length; j++) {
          if (
            newRates[i].currencyCodeA ===
              cachedExchangeRates.data[j].currencyCodeA &&
            newRates[i].currencyCodeB ===
              cachedExchangeRates.data[j].currencyCodeB
          ) {
            // Compare rates for the same currency pair to see if they have changed
            if (
              newRates[i].rateBuy !== cachedExchangeRates.data[j].rateBuy ||
              newRates[i].rateSell !== cachedExchangeRates.data[j].rateSell
            ) {
              bot.sendMessage(chatId, "Exchange rates have changed!");
              console.log("Rates have changed:", newRates);
              ratesChanged = true;
            }
            break;
          }
        }
      }
      if (!ratesChanged && newRates.length > 0) {
        bot.sendMessage(chatId, "Exchange rates remain the same.");
      }
    } else {
      console.log("Failed to fetch exchange rates");
    }
  }, 15 * 60 * 1000); // Run every 15 minutes
};

startFetchingRates();
