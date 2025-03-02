// src/db.js
const fs = require("fs");
const path = require("path");

const LOG_FILE = path.join(__dirname, "..", "logs", "chat_logs.json");
const MAX_MESSAGES_PER_CHAT = 50;

// Read the JSON log file; if not exists, return an empty object.
function readLogs() {
  try {
    const data = fs.readFileSync(LOG_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading log file:", err);
    return {};
  }
}

// Write logs back to the file.
function writeLogs(logs) {
  try {
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), "utf8");
  } catch (err) {
    console.error("Error writing log file:", err);
  }
}

// Log a message to the JSON file.
function logMessage(chatId, role, message) {
  const logs = readLogs();
  if (!logs[chatId]) {
    logs[chatId] = [];
  }
  logs[chatId].push({
    role,
    message,
    timestamp: Date.now(),
  });
  // Prune if too many messages.
  if (logs[chatId].length > MAX_MESSAGES_PER_CHAT) {
    logs[chatId] = logs[chatId].slice(-MAX_MESSAGES_PER_CHAT);
  }
  writeLogs(logs);
}

module.exports = {
  logMessage,
};
