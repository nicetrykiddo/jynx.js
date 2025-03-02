// src/model.js
const axios = require("axios");
const API_BASE = process.env.AI_SERVICE_URL || "http://0.0.0.0:8000";

/**
 * Calls the classify endpoint.
 */
async function classifyMessage(chatId, text) {
  try {
    const response = await axios.post(
      `${API_BASE}/classify`,
      {
        chat_id: chatId,
        text: text,
        max_tokens: 1000, // Not used in classification but required by schema.
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 15000,
      }
    );
    return response.data;
  } catch (err) {
    throw new Error("Error in classifyMessage: " + err.message);
  }
}

/**
 * Calls the generate endpoint with specified mode.
 */
async function generateMessage(chatId, text, max_tokens, mode) {
  try {
    const response = await axios.post(
      `${API_BASE}/generate`,
      {
        chat_id: chatId,
        text: text,
        max_tokens: max_tokens,
        mode: mode, // "chat", "code", "mixture", or empty.
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 60000,
      }
    );
    return response.data;
  } catch (err) {
    throw new Error("Error in generateMessage: " + err.message);
  }
}

module.exports = { classifyMessage, generateMessage };
