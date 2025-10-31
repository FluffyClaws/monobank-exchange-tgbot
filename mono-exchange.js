const fs = require("fs");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
require("dotenv").config();

const TOKEN = process.env.TELEGRAM_API_TOKEN;
const TIMEZONE = process.env.TZ || "Europe/Kyiv";
const FETCH_INTERVAL = 15 * 60; // seconds
const LOG_FILE = path.join(__dirname, "bot.log");

const bot = new TelegramBot(TOKEN, { polling: true });
const CURRENCY_MAP = { "840:980": "🇺🇸", "978:980": "🇪🇺" };

let chatIds = [];
let cachedExchangeRates = { data: [], timestamp: 0 };






function getCurrentTimestamp() {
  return new Date().toISOString().replace("T", " ").split(".")[0];
}

function writeLog(entry) {
  const line = `[${getCurrentTimestamp()}] ${entry}\n`;
  fs.appendFileSync(LOG_FILE, line);
  console.log(line.trim());
}

function log(msg, ...args) {
  const formatted = [msg, ...args].map((a) => (typeof a === "object" ? JSON.stringify(a) : a)).join(" ");
  writeLog(formatted);
}






bot.on("polling_error", (err) => {
  log(`Polling error: ${err.message}`);
  if (err.code === "EFATAL") {
    log("Restarting bot polling...");
    bot.stopPolling()
      .then(() => bot.startPolling())
      .then(() => log("Bot restarted successfully"))
      .catch((e) => log("Bot restart failed:", e.message));
  }
});

process.on("SIGTERM", async () => {
  log("SIGTERM received, stopping polling...");
  await bot.stopPolling();
  process.exit(0);
});

process.on("uncaughtException", (err) => log("Uncaught exception:", err));
process.on("unhandledRejection", (reason) => log("Unhandled rejection:", reason));






bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  if (!chatIds.includes(chatId)) chatIds.push(chatId);
  bot.sendMessage(chatId, "Bot active. Use /rates to view currency rates.");
});

bot.onText(/\/rates/, async (msg) => {
  const chatId = msg.chat.id;
  const now = Math.floor(Date.now() / 1000);
  const cacheAge = now - cachedExchangeRates.timestamp;

  if (cacheAge < FETCH_INTERVAL && cachedExchangeRates.data.length > 0) {
    sendRatesMessage(
      chatId,
      filterRates(cachedExchangeRates.data),
      cachedExchangeRates.timestamp,
      true
    );
    return;
  }

  const rates = await fetchExchangeRates();
  if (!rates || rates.length === 0) {
    bot.sendMessage(chatId, "Failed to fetch exchange rates. Try again later.");
    return;
  }

  cachedExchangeRates = { data: rates, timestamp: now };
  sendRatesMessage(chatId, filterRates(rates), now, false);
});




async function fetchExchangeRates(retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      log("Fetching exchange rates from Monobank API...");
      const res = await axios.get("https://api.monobank.ua/bank/currency");
      if (res.status === 200) return res.data;
      if (res.status === 429) {
        log("Too many requests. Waiting 30s...");
        await new Promise((r) => setTimeout(r, 30000));
      } else {
        log(`Unexpected status ${res.status}`);
      }
    } catch (err) {
      log("Error fetching exchange rates:", err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  return null;
}

function filterRates(rates) {
  return rates.filter(
    (r) =>
      (r.currencyCodeA === 840 && r.currencyCodeB === 980) ||
      (r.currencyCodeA === 978 && r.currencyCodeB === 980)
  );
}

function ratesHaveChanged(oldRates, newRates) {
  if (oldRates.length !== newRates.length) return true;
  return oldRates.some((oldRate) => {
    const newRate = newRates.find(
      (r) =>
        r.currencyCodeA === oldRate.currencyCodeA &&
        r.currencyCodeB === oldRate.currencyCodeB
    );
    return (
      !newRate ||
      oldRate.rateBuy !== newRate.rateBuy ||
      oldRate.rateSell !== newRate.rateSell
    );
  });
}








function sendRatesMessage(chatId, rates, timestamp, isCached = false) {
  const rateMessage = rates
    .map((r) => {
      const symbol = CURRENCY_MAP[`${r.currencyCodeA}:${r.currencyCodeB}`] || "";
      return `${symbol} ${r.rateBuy.toFixed(2)} / ${r.rateSell.toFixed(2)}`;
    })
    .join("\n");

  const dateTime = new Date(timestamp * 1000).toLocaleString("en-GB", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  let messageHeader = `Rates as of ${dateTime}`;
  if (isCached) {
    const cachedTime = new Date(timestamp * 1000).toLocaleTimeString("en-GB", {
      timeZone: TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
    });
    messageHeader += ` (Cached at ${cachedTime})`;
  }

  const fullMessage = `${messageHeader}:\n${rateMessage}`;
  bot.sendMessage(chatId, fullMessage);
  log(`Sent rates to ${chatId}: ${fullMessage.replace(/\n/g, " | ")}`);
}








async function updateRates() {
  const now = Math.floor(Date.now() / 1000);
  const cacheAge = now - cachedExchangeRates.timestamp;
  if (cacheAge < FETCH_INTERVAL) {
    log("Using cached exchange rates.");
    return;
  }

  log("Fetching fresh exchange rates...");
  const newRates = await fetchExchangeRates();
  if (!newRates) {
    log("Failed to fetch new rates.");
    return;
  }

  if (ratesHaveChanged(cachedExchangeRates.data, newRates)) {
    cachedExchangeRates = { data: newRates, timestamp: now };
    const formattedTime = new Date(now * 1000).toLocaleString("en-GB", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    log(`Rates updated at ${formattedTime}: ${JSON.stringify(filterRates(newRates))}`);

    chatIds.forEach((id) =>
      sendRatesMessage(id, filterRates(newRates), cachedExchangeRates.timestamp)
    );
  } else {
    log("Rates unchanged.");
  }
}

setInterval(updateRates, FETCH_INTERVAL * 1000);
