// src/bot.js
require("dotenv").config();
const { Telegraf } = require("telegraf");
const axios = require("axios");
const path = require("path");
const { logConversation } = require("./db");
const { logInfo, logError } = require("./utils");
const { commitNewCommand } = require("./github");

const BOT_TOKEN = process.env.BOT_TOKEN;
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";
const OWNER_IDS = process.env.OWNER_IDS
  ? process.env.OWNER_IDS.split(",").map((id) => id.trim())
  : [];

const bot = new Telegraf(BOT_TOKEN);

// Known commands that the bot handles natively.
const knownCommands = ["start", "help", "chat", "code", "mixture"];

// Helper: Extract command name and remaining text if message starts with a slash.
function parseCommand(text) {
  const parts = text.trim().split(" ");
  const cmd = parts[0].slice(1).toLowerCase(); // remove '/'
  const rest = parts.slice(1).join(" ");
  return { cmd, rest };
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
      "- For a normal chat reply, type your message normally or use /chat\n" +
      "- For code generation, prefix your message with /code\n" +
      "- For a mixture (code with conversational commentary), use /mixture\n" +
      "If you send an unrecognized command and you're an owner, I'll auto-generate a new command for you."
  );
});

// Handler for all messages that start with '/'
bot.on("text", async (ctx) => {
  const chatId = String(ctx.chat.id);
  const text = ctx.message.text;

  // If the message starts with '/', check if it's a recognized command.
  if (text.trim().startsWith("/")) {
    const { cmd, rest } = parseCommand(text);
    // If the command is known, let Telegraf handle it (it will trigger /start or /help).
    if (knownCommands.includes(cmd)) {
      return; // Already handled by specific command handlers.
    }
    // If unrecognized, and if sender is an owner, trigger self-modification.
    if (OWNER_IDS.includes(String(ctx.from.id))) {
      const description = rest || "perform its intended function";
      logInfo(
        `Owner ${ctx.from.id} triggered autogen for command /${cmd} with description: ${description}`
      );
      try {
        // Call the autogen endpoint on your AI service.
        const autogenRes = await axios.post(
          `${AI_SERVICE_URL}/autogen`,
          {
            command_name: cmd,
            description: description,
            max_tokens: 150,
          },
          { headers: { "Content-Type": "application/json" }, timeout: 60000 }
        );
        const commandCode = autogenRes.data.command_code;
        ctx.reply(
          `Generated code for /${cmd}:\n\`\`\`js\n${commandCode}\n\`\`\`\nSubmitting to GitHub for review...`
        );
        // Call GitHub integration to commit this new command file.
        await commitNewCommand(cmd, commandCode);
        ctx.reply(`✅ Successfully submitted /${cmd} command for review.`);
      } catch (err) {
        logError(`Autogen error for /${cmd}: ${err.message}`);
        ctx.reply(`⚠️ Error generating command /${cmd}: ${err.message}`);
      }
      return;
    } else {
      ctx.reply("Unrecognized command. Use /help for guidance.");
      return;
    }
  }

  // For non-command text messages:
  // Log the incoming message.
  logConversation(chatId, "user", text);

  // Call the intent classifier endpoint.
  try {
    const classifyRes = await axios.post(
      `${AI_SERVICE_URL}/classify`,
      {
        chat_id: chatId,
        text: text,
        max_tokens: 1000,
      },
      { headers: { "Content-Type": "application/json" }, timeout: 15000 }
    );
    const shouldReply = classifyRes.data.should_reply;
    if (!shouldReply) {
      logInfo(`No reply needed for chat ${chatId}`);
      return;
    }
  } catch (err) {
    logError(`Classification error: ${err.message}`);
    return;
  }

  // Call the generate endpoint.
  try {
    // No mode specified here; the AI service will decide based on heuristics.
    const genRes = await axios.post(
      `${AI_SERVICE_URL}/generate`,
      {
        chat_id: chatId,
        text: text,
        max_tokens: 1000,
        mode: "", // Let the AI service decide the best mode.
      },
      { headers: { "Content-Type": "application/json" }, timeout: 60000 }
    );
    const reply = genRes.data.reply;
    await ctx.reply(reply);
    logConversation(chatId, "assistant", reply);
  } catch (err) {
    logError(`Generation error: ${err.message}`);
    ctx.reply("⚠️ Sorry, I'm having trouble generating a response.");
  }
});

bot.launch().then(() => {
  logInfo("Telegram bot is running...");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
