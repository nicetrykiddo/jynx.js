// src/bot.js
require("dotenv").config();
const { Telegraf } = require("telegraf");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { classifyMessage, generateMessage } = require("./model");
const { logConversation } = require("./db");
const { logInfo, logError } = require("./utils");

const BOT_TOKEN = process.env.BOT_TOKEN;
const INTENT_ENDPOINT =
  process.env.AI_SERVICE_URL + "/classify" || "http://localhost:8000/classify";
const GENERATE_ENDPOINT =
  process.env.AI_SERVICE_URL + "/generate" || "http://localhost:8000/generate";

const bot = new Telegraf(BOT_TOKEN);

// Helper: Determine mode from message prefix
function parseMode(text) {
  const trimmed = text.trim();
  // Check for commands: /code, /chat, /mixture (case-insensitive)
  if (trimmed.toLowerCase().startsWith("/code")) {
    return { mode: "code", newText: trimmed.slice(5).trim() };
  } else if (trimmed.toLowerCase().startsWith("/chat")) {
    return { mode: "chat", newText: trimmed.slice(5).trim() };
  } else if (trimmed.toLowerCase().startsWith("/mixture")) {
    return { mode: "mixture", newText: trimmed.slice(8).trim() };
  }
  // If no prefix, return empty mode so that the AI service decides
  return { mode: "", newText: text };
}

// /start command
bot.start((ctx) => {
  ctx.reply(
    "🤖 Hi! I'm your smart AI bot. Use /chat, /code, or /mixture as a prefix to set mode, or just type your message."
  );
});

// /help command
bot.help((ctx) => {
  ctx.reply(
    "Usage:\n" +
      "- To get a normal chat reply: type your message normally or prefix with /chat\n" +
      "- To generate code: prefix your message with /code\n" +
      "- To get a mixture (code + chat flavor): prefix with /mixture\n" +
      "If no mode is specified, I'll try to decide for you!"
  );
});

// Main text handler
bot.on("text", async (ctx) => {
  const chatId = String(ctx.chat.id);
  let { mode, newText } = parseMode(ctx.message.text);
  if (!newText) newText = ctx.message.text; // fallback

  // Log incoming message
  logConversation(chatId, "user", newText);

  // Call the intent classifier service
  try {
    const classifyRes = await classifyMessage(chatId, newText);
    if (!classifyRes.should_reply) {
      logInfo(`No reply needed for chat ${chatId}`);
      return;
    }
  } catch (err) {
    logError(`Classification error: ${err.message}`);
    // Optionally continue even if classification fails.
    return;
  }

  // Use the provided mode if set; otherwise pass empty string to let AI service decide.
  try {
    const generateRes = await generateMessage(chatId, newText, 1000, mode);
    const reply = generateRes.reply;
    await ctx.reply(reply);
    logConversation(chatId, "assistant", reply);
  } catch (err) {
    logError(`Generation error: ${err.message}`);
    await ctx.reply("⚠️ Sorry, I'm having trouble generating a response.");
  }
});

bot.launch().then(() => {
  logInfo("Telegram bot is running...");
});

// Graceful shutdown
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
