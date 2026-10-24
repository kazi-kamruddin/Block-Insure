const test = require("node:test");
const assert = require("node:assert/strict");
const load = require("./helpers/loadIsolatedModule");
const environment = { NODE_ENV: "test", OTP_DELIVERY_MODE: "brevo", BREVO_API_KEY: "not-a-real-key", BREVO_SENDER_EMAIL: "sender@example.com" };
test("OTP delivery never calls a provider in simulation and production cannot expose a demo code", async () => {
  const local = load("services/otpDeliveryService.js", {}, { NODE_ENV: "test" });
  const result = await local.deliverOtp({ otp: "123456" }, { fetchImpl: () => { throw new Error("Must not call"); } });
  assert.equal(result.demoOtp, "123456");
  assert.throws(() => load("services/otpDeliveryService.js", {}, { NODE_ENV: "production", OTP_DELIVERY_MODE: "simulation" }).deliveryMode(), /invalid/);
  assert.throws(() => load("services/otpDeliveryService.js", {}, { NODE_ENV: "production" }).deliveryMode(), /disabled/);
});
test("Brevo accepts only the fixed endpoint and never returns the payment code", async () => {
  const service = load("services/otpDeliveryService.js", {}, environment);
  let calls = 0;
  const result = await service.deliverOtp({ email: "recipient@example.com", otp: "123456", purpose: "payment" }, { fetchImpl: async (url, options) => {
    calls++; assert.equal(url, "https://api.brevo.com/v3/smtp/email"); assert.equal(options.redirect, "error");
    assert.equal(options.headers["api-key"], environment.BREVO_API_KEY);
    const payload = JSON.parse(options.body); assert.equal(payload.to[0].email, "recipient@example.com");
    assert.match(payload.textContent, /123456/); return { ok: true, status: 201, json: async () => ({ messageId: "synthetic-acceptance" }) };
  } });
  assert.equal(calls, 1); assert.equal(result.deliveryMode, "brevo"); assert.equal(result.demoOtp, undefined);
  assert.doesNotMatch(JSON.stringify(result), /123456|recipient@example.com/);
});
test("provider errors/timeouts fail closed and are sanitized without simulated fallback", async () => {
  const service = load("services/otpDeliveryService.js", {}, environment);
  for (const fetchImpl of [async () => ({ ok: false, status: 401 }), async () => ({ ok: true, status: 201, json: async () => ({}) }), async () => { throw new Error("private-key-and-otp"); }]) {
    await assert.rejects(service.deliverOtp({ email: "recipient@example.com", otp: "123456" }, { fetchImpl }), (error) => error.statusCode === 503 && !/private-key|123456/.test(error.message));
  }
});
