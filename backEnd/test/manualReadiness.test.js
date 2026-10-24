const test = require("node:test"), assert = require("node:assert/strict");
const { inspectConfiguration, inspectLocal } = require("../../scripts/manualReadiness");
test("manual configuration diagnostics never serialize credentials, inboxes or malformed environment values", () => {
  const values = { MONGODB_URI: "mongodb+srv://private-user:private-password@cluster.example/database", BANK_OTP_SECRET: "private-otp",
    BREVO_API_KEY: "private-brevo", BREVO_SENDER_EMAIL: "private-inbox@example.com", OTP_DELIVERY_MODE: "private-invalid-mode" };
  const report = JSON.stringify(inspectConfiguration(values));
  for (const secret of Object.values(values)) assert.equal(report.includes(secret), false);
  assert.equal(inspectConfiguration({ NODE_ENV: "production", OTP_DELIVERY_MODE: "simulation" }).find((r) => r.check === "Email configuration").status, "ACTION");
  assert.equal(inspectConfiguration({ MONGODB_URI: "https://invalid-database.example" }).find((r) => r.check === "Database target").status, "ACTION");
  assert.equal(inspectConfiguration({ MONGODB_URI: "mongodb://127.0.0.1:27019/block_insure_manual_dev" }).find((r) => r.check === "Fresh manual demo target").status, "READY");
});
test("offline configuration does not contact providers and Brevo presence is not delivery proof", () => {
  const rows = inspectConfiguration({ OTP_DELIVERY_MODE: "brevo", BREVO_API_KEY: "synthetic", BREVO_SENDER_EMAIL: "sender@example.com" });
  assert.equal(rows.find((r) => r.check === "Email configuration").status, "CONFIGURED");
  assert.equal(rows.find((r) => r.check === "Real delivery proof").status, "MANUAL");
});
test("local readiness probes only known loopback endpoints and never accept unhealthy HTTP responses", async () => {
  const calls = [];
  const rows = await inspectLocal({ deployment: { CONTRACT_ADDRESS: `0x${"1".repeat(40)}` }, fetchImpl: async (url, options) => {
    const parsed = new URL(url); assert.ok(["localhost", "127.0.0.1"].includes(parsed.hostname)); calls.push({ url, options });
    if (parsed.port === "8545") {
      const request = JSON.parse(options.body); assert.ok(["eth_chainId", "eth_getCode"].includes(request.method));
      return { ok: true, json: async () => ({ result: request.method === "eth_chainId" ? "0x7a69" : "0x" }) };
    }
    return { ok: false, json: async () => ({ status: "ready", services: { database: "connected" }, workerEnabled: true }), text: async () => "Block-Insure" };
  } });
  assert.ok(rows.every((row) => row.status === "ACTION"));
  assert.equal(calls.length, 6);
});
