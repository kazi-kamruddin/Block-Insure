const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const logDirectory =
  process.env.DEV_OBSERVABILITY_LOG_DIR || path.join(projectRoot, ".dev-logs");
const eventFile =
  process.env.DEV_OBSERVABILITY_LOG_FILE ||
  path.join(logDirectory, "events.jsonl");

const sensitiveKeyPattern =
  /(private.?key|secret|password|token|api.?key|authorization|cookie|credential|mnemonic|pem)/i;

function redactValue(value, key = "") {
  if (sensitiveKeyPattern.test(key)) return "[REDACTED]";

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactValue(entryValue, entryKey),
      ])
    );
  }

  if (typeof value !== "string") return value;

  return value
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[REDACTED_PEM]")
    .replace(/0x[a-f0-9]{64}/gi, (match) => `[HEX64:${match.slice(-8)}]`)
    .replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_.-]+\.[a-zA-Z0-9_.-]+\b/g, "[REDACTED_JWT]");
}

function formatMessage(parts) {
  return parts
    .map((part) => {
      if (typeof part === "string") return redactValue(part);
      try {
        return JSON.stringify(redactValue(part));
      } catch {
        return String(part);
      }
    })
    .join(" ")
    .trim();
}

function writeEvent(component, level, ...parts) {
  try {
    fs.mkdirSync(logDirectory, { recursive: true });
    const event = {
      timestamp: new Date().toISOString(),
      component: String(component || "app"),
      level: String(level || "info").toLowerCase(),
      message: formatMessage(parts),
    };
    fs.appendFileSync(eventFile, `${JSON.stringify(event)}\n`, "utf8");
  } catch {
    // Observability must never take down the application.
  }
}

module.exports = {
  eventFile,
  formatMessage,
  logDirectory,
  redactValue,
  writeEvent,
};
