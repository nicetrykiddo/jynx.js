// src/bot.js
require("dotenv").config();
const { Telegraf } = require("telegraf");
const { generateAIReply } = require("./model");
const { logMessage } = require("./db");
const { commitNewCommand } = require("./github");
const { logDecision, logError } = require("./utils");

// Initialize Telegraf bot with your BOT_TOKEN
const bot = new Telegraf(process.env.BOT_TOKEN);

// Command: /start
bot.start((ctx) => {
  ctx.reply(
    "🤖 Hello! I'm your AI-powered bot. Type anything or /help for commands."
  );
});

// Command: /help
bot.command("help", (ctx) => {
  ctx.reply(
    "Available commands:\n/start - Start bot\n/help - Show this help message\n(For owners: generating new commands if undefined.)"
  );
});

// Handle text messages (chat mode)
bot.on("text", async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const userMessage = ctx.message.text;

  // Log the user's message
  logMessage(chatId, "user", userMessage);

  // Get AI response (replace this with your model integration later)
  let aiReply;
  try {
    aiReply = await generateAIReply(chatId, userMessage);
  } catch (err) {
    logError(err);
    aiReply = "⚠️ Sorry, I encountered an error.";
  }

  // Reply to user and log the response
  await ctx.reply(aiReply);
  logMessage(chatId, "assistant", aiReply);
});

// Example: Handling an undefined command (owner only triggers AI code generation)
bot.on("text", async (ctx) => {
  const messageText = ctx.message.text;
  if (messageText.startsWith("/")) {
    // Extract command (remove leading slash)
    const cmdName = messageText.split(" ")[0].slice(1).toLowerCase();
    // For simplicity, if command is not recognized and sender is owner, generate new command
    const ownerIds = process.env.OWNER_IDS.split(",").map((id) => id.trim());
    if (ownerIds.includes(String(ctx.from.id))) {
      // Here, you could call your AI code generation function.
      // For now, we'll simulate by creating a dummy command that echoes text.
      const generatedCode =
        "async function " +
        cmdName +
        "(ctx) { await ctx.reply('This is the new /" +
        cmdName +
        " command.'); }";
      try {
        await commitNewCommand(cmdName, generatedCode);
        ctx.reply(
          `✅ Generated code for /${cmdName} and opened a PR on GitHub for review.`
        );
        logDecision(
          `Generated code for /${cmdName} by owner ${
            ctx.from.username || ctx.from.id
          }`
        );
      } catch (err) {
        ctx.reply(`⚠️ Failed to commit new command: ${err.message}`);
      }
    }
  }
});

// Start the bot
bot.launch().then(() => {
  console.log("Bot is running...");
});

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
