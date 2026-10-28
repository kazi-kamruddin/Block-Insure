// Test-only backend launcher. The production adapter still targets Brevo's
// fixed endpoint; only this process substitutes an in-memory provider response.
const http = require("node:http");
const crypto = require("node:crypto");
const database = new URL(process.env.MONGODB_URI);
if (process.env.E2E_BREVO_STUB !== "true" || process.env.NODE_ENV !== "development" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/^\/block_insure_[a-z0-9_]*e2e$/.test(database.pathname) ||
    process.env.BREVO_API_KEY !== "block-insure-synthetic-only" || !process.env.E2E_MAILBOX_TOKEN) {
  throw new Error("Local mail stub requires the isolated disposable E2E environment");
}
const messages = [];
let failNext = false;
const originalFetch = global.fetch;
global.fetch = async (url, options) => {
  if (String(url) !== "https://api.brevo.com/v3/smtp/email") return originalFetch(url, options);
  const payload = JSON.parse(options.body);
  if (options.method !== "POST" || options.headers["api-key"] !== "block-insure-synthetic-only" ||
      payload.sender.email !== "sender@example.test" || !payload.to?.[0]?.email.endsWith("@example.test")) {
    throw new Error("Mail stub refuses non-synthetic provider input");
  }
  if (failNext) { failNext = false; return new Response("{}", { status: 401 }); }
  const code = payload.textContent.match(/code is (\d{6})\./)?.[1];
  if (!code) throw new Error("Mail stub received an invalid message");
  const messageId = crypto.randomUUID();
  messages.push({ recipient: payload.to[0].email, subject: payload.subject, code, messageId });
  return Response.json({ messageId }, { status: 201 });
};
const mailbox = http.createServer(async (request, response) => {
  response.setHeader("content-type", "application/json");
  response.setHeader("cache-control", "no-store");
  if (request.headers.authorization !== `Bearer ${process.env.E2E_MAILBOX_TOKEN}`) {
    response.writeHead(401); response.end("{}"); return;
  }
  const url = new URL(request.url, "http://127.0.0.1:5060");
  if (request.method === "GET" && url.pathname === "/messages") {
    response.end(JSON.stringify(messages.filter((message) => message.recipient === url.searchParams.get("recipient"))));
  } else if (request.method === "POST" && url.pathname === "/fail-next") {
    failNext = true; response.end("{}");
  } else { response.writeHead(404); response.end("{}"); }
});
mailbox.on("error", () => { console.error("Local test mailbox could not start"); process.exit(1); });
mailbox.listen(5060, "127.0.0.1", () => require("../../backEnd/server.js"));
