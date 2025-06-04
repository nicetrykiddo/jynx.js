// src/db.js
const fs = require("fs");
const path = require("path");

const LOG_FILE = path.join(__dirname, "..", "logs", "chat_logs.json");
const MAX_MESSAGES_PER_CHAT = 50;

function readLogs() {
  try {
    const data = fs.readFileSync(LOG_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    return {};
  }
}

function writeLogs(logs) {
  try {
    // Ensure the logs directory exists before writing
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), "utf8");
  } catch (err) {
    console.error("Error writing logs:", err.message);
  }
}

function logConversation(chatId, role, text) {
  const logs = readLogs();
  if (!logs[chatId]) logs[chatId] = [];
  logs[chatId].push({ role, text, timestamp: Date.now() });
  if (logs[chatId].length > MAX_MESSAGES_PER_CHAT) {
    logs[chatId] = logs[chatId].slice(-MAX_MESSAGES_PER_CHAT);
  }
  writeLogs(logs);
}

module.exports = { logConversation };
