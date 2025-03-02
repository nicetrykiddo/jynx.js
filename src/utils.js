// src/utils.js
function logDecision(message) {
  console.log("[DECISION]", message);
}

function logError(error) {
  console.error("[ERROR]", error);
}

module.exports = {
  logDecision,
  logError,
};
