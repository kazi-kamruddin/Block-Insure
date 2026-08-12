const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const readline = require("node:readline");
const { eventFile, formatMessage } = require("./observability");

const POLL_INTERVAL_MS = 500;
const SERVICE_POLL_INTERVAL_MS = 5000;
const DEDUPE_WINDOW_MS = 4000;
const REPEAT_REPORT_INTERVAL_MS = 5000;

const serviceEndpoints = [
  { name: "Chain", host: "127.0.0.1", port: 8545 },
  { name: "Backend", host: "127.0.0.1", port: 5000 },
  { name: "Frontend", host: "127.0.0.1", port: 5173 },
];

let fileOffset = 0;
let partialLine = "";
let lastServicePollAt = 0;
let lastStatus = new Map();
const recentEvents = new Map();

function output(level, message) {
  const marker = level === "error" ? "!!" : level === "warn" ? "!" : "·";
  const timestamp = new Date().toLocaleTimeString();
  process.stdout.write(`${timestamp} ${marker} ${message}\n`);
}

function simplify(message) {
  const normalized = formatMessage([message])
    .replace(/^\[(?:Backend|Frontend|Chain|Oracle[^\]]*|Launcher)\]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  const request = normalized.match(/(?:GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s]+)\s+(\d{3})/i);
  if (request) {
    return `HTTP ${request[1].toUpperCase()} ${request[2]} ${request[3]}`;
  }

  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}

function eventLevel(event) {
  const message = String(event.message || "");
  if (event.level === "error" || /(error|failed|failure|rejected|denied|timeout|exception)/i.test(message)) {
    return "error";
  }
  if (event.level === "warn" || /(warning|warn|retry|offline|stale)/i.test(message)) {
    return "warn";
  }
  return "info";
}

function showEvent(event) {
  const message = simplify(event.message);
  if (!message) return;

  const level = eventLevel(event);
  const key = `${event.component}|${level}|${message}`;
  const now = Date.now();
  const previous = recentEvents.get(key);

  if (previous && now - previous.lastSeen < DEDUPE_WINDOW_MS) {
    previous.count += 1;
    previous.lastSeen = now;
    return;
  }

  if (previous?.count > 1) {
    output("info", `${event.component}: repeated ${previous.count}x — ${message}`);
  }

  recentEvents.set(key, { count: 1, lastSeen: now, lastReportedAt: now });
  output(level, `${event.component}: ${message}`);
}

function flushRepeatedEvents() {
  const now = Date.now();
  for (const [key, entry] of recentEvents) {
    if (entry.count > 1 && now - entry.lastReportedAt >= REPEAT_REPORT_INTERVAL_MS) {
      const [, , message] = key.split("|");
      output("info", `repeat summary: ${entry.count}x — ${message}`);
      entry.count = 0;
      entry.lastReportedAt = now;
    }
  }
}

function readNewEvents() {
  if (!fs.existsSync(eventFile)) return;

  const stats = fs.statSync(eventFile);
  if (stats.size < fileOffset) {
    fileOffset = 0;
    partialLine = "";
    output("warn", "event stream rotated; cursor reset");
  }

  if (stats.size === fileOffset) return;

  const handle = fs.openSync(eventFile, "r");
  const buffer = Buffer.alloc(stats.size - fileOffset);
  fs.readSync(handle, buffer, 0, buffer.length, fileOffset);
  fs.closeSync(handle);
  fileOffset = stats.size;

  const lines = `${partialLine}${buffer.toString("utf8")}`.split(/\r?\n/);
  partialLine = lines.pop() || "";

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      showEvent(JSON.parse(line));
    } catch {
      showEvent({ component: "stream", level: "warn", message: line });
    }
  }
}

function probePort(endpoint) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: endpoint.host, port: endpoint.port });
    const finish = (online) => {
      socket.destroy();
      resolve(online);
    };
    socket.setTimeout(1000, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function pollServices() {
  if (Date.now() - lastServicePollAt < SERVICE_POLL_INTERVAL_MS) return;
  lastServicePollAt = Date.now();

  const states = await Promise.all(
    serviceEndpoints.map(async (endpoint) => ({
      ...endpoint,
      online: await probePort(endpoint),
    }))
  );

  for (const service of states) {
    const previous = lastStatus.get(service.name);
    if (previous !== service.online) {
      lastStatus.set(service.name, service.online);
      output(
        service.online ? "info" : "warn",
        `${service.name}: ${service.online ? "online" : "offline"} (${service.port})`
      );
    }
  }
}

async function main() {
  output("info", "developer observability started; secrets are redacted");
  output("info", `watching ${eventFile}`);
  output("info", "press Ctrl+C to stop observation");

  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  terminal.on("line", (line) => {
    if (line.trim().toLowerCase() === "clear") {
      process.stdout.write("\x1Bc");
      output("info", "display cleared; observation continues");
    }
  });

  const timer = setInterval(() => {
    readNewEvents();
    flushRepeatedEvents();
    pollServices().catch((error) => output("warn", `service probe: ${error.message}`));
  }, POLL_INTERVAL_MS);

  process.on("SIGINT", () => {
    clearInterval(timer);
    terminal.close();
    process.exit(0);
  });
}

main().catch((error) => {
  output("error", `observer failed: ${error.message}`);
  process.exitCode = 1;
});
