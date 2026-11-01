const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");

// Exercise the actual server orchestration with controlled subsystem boundaries.
// No database, public RPC, scheduler or real email is contacted.
function boot({ blockchain = true, databaseFailure = false } = {}) {
  let resolveIndex, rejectIndex;
  const indexing = new Promise((resolve, reject) => {
    resolveIndex = resolve; rejectIndex = reject;
  });
  const calls = [], routes = new Map(), exits = [];
  const server = new EventEmitter();
  server.listening = false;
  server.close = (callback) => { server.listening = false; calls.push("http.close"); callback(); };
  const app = {
    disable() {}, set() {}, use() {},
    get(route, handler) { routes.set(route, handler); },
    listen() {
      calls.push("http.listen"); server.listening = true;
      queueMicrotask(() => server.emit("listening"));
      return server;
    },
  };
  const express = () => app;
  express.json = express.urlencoded = () => () => {};
  const services = {
    notificationService: {
      startBlockchainEventListener: async () => calls.push("listener.start"),
      stopBlockchainEventListener: async () => calls.push("listener.stop"),
    },
    blockchainIndexerService: {
      startBlockchainIndexer: () => { calls.push("indexer.start"); return indexing; },
      stopBlockchainIndexer: () => calls.push("indexer.stop"),
    },
    readinessService: { buildHealthPayload: async () => ({ success: true, status: "ready" }) },
  };
  for (const [name, start, stop] of [
    ["registryPublicationService", "startRegistryPublisher", "stopRegistryPublisher"],
    ["evidenceAnchorService", "startEvidenceAnchorScheduler", "stopEvidenceAnchorScheduler"],
    ["reviewAccessService", "startReviewAccessScheduler", "stopReviewAccessScheduler"],
    ["bankPaymentService", "startBankPaymentScheduler", "stopBankPaymentScheduler"],
  ]) services[name] = { [start]: () => calls.push(start), [stop]: () => calls.push(stop) };
  const mongoose = {
    connect: async () => { if (databaseFailure) throw Error("database unavailable"); calls.push("database.connected"); },
    connection: { readyState: 1, close: async () => calls.push("database.close") },
  };
  const sandbox = {
    module: { exports: {} }, console: { log() {}, warn() {}, error() {} },
    process: {
      env: { NODE_ENV: "test", MONGODB_URI: "mongodb://unused/test", JWT_SECRET: "unused-test-secret", PORT: "0" },
      uptime: () => 1, exit: (code) => exits.push(code), on() {},
    },
    require(name) {
      if (name === "dotenv") return { config() {} };
      if (name === "dns") return { setDefaultResultOrder() {}, setServers() {} };
      if (name === "express") return express;
      if (name === "mongoose") return mongoose;
      if (["cors", "helmet", "morgan"].includes(name)) return () => () => {};
      if (name.includes("observability")) return { writeEvent() {} };
      if (name === "./config/runtimeConfig") return { assertRuntimeEnvironment: () => ({ warnings: [], allowedOrigins: [], blockchainRuntimeEnabled: blockchain }) };
      if (name.startsWith("./routes/")) return () => {};
      if (name.startsWith("./services/")) {
        const service = services[name.slice("./services/".length)];
        assert.ok(service, `Unexpected service: ${name}`); return service;
      }
      throw Error(`Unexpected module: ${name}`);
    },
  };
  const source = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8")
    .replace(/^startServer\(\);$/m, "const started = startServer();");
  vm.runInNewContext(source + "\nmodule.exports = { started, healthPayload };", sandbox);
  return { ...sandbox.module.exports, calls, routes, server, exits, resolveIndex, rejectIndex };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("HTTP liveness is available during blocked catch-up, while readiness stays 503", async () => {
  const b = boot(); await tick();
  assert.deepEqual(b.calls, ["database.connected", "http.listen", "indexer.start"]);
  assert.equal(b.server.listening, true);
  let status, body;
  const response = { set() { return this; }, status(value) { status = value; return this; }, json(value) { body = value; } };
  b.routes.get("/health/live")({}, response);
  assert.equal(status, 200); assert.equal(body.success, true);
  await b.routes.get("/health/ready")({}, response);
  assert.equal(status, 503); assert.equal(body.success, false); assert.equal(body.status, "starting");
  b.resolveIndex(); await b.started;
  await b.routes.get("/health/ready")({}, response);
  assert.equal(status, 200); assert.equal(body.success, true);
  assert.ok(b.calls.includes("listener.start")); assert.deepEqual(b.exits, []);
});

test("indexer initialization failure closes the listener and exits without advertising readiness", async () => {
  const b = boot(); await tick(); b.rejectIndex(Error("RPC unavailable")); await b.started;
  assert.equal(b.server.listening, false);
  assert.ok(b.calls.includes("http.close")); assert.ok(b.calls.includes("indexer.stop"));
  assert.ok(b.calls.includes("database.close")); assert.deepEqual(b.exits, [1]);
  assert.equal((await b.healthPayload()).success, false);
});

test("off-chain preview starts without waiting for the blockchain indexer", async () => {
  const b = boot({ blockchain: false }); await b.started;
  assert.equal(b.server.listening, true); assert.equal(b.calls.includes("indexer.start"), false);
  assert.equal((await b.healthPayload()).success, true); assert.deepEqual(b.exits, []);
});

test("database connection failure never opens the HTTP listener", async () => {
  const b = boot({ databaseFailure: true }); await b.started;
  assert.equal(b.calls.includes("http.listen"), false); assert.deepEqual(b.exits, [1]);
});
