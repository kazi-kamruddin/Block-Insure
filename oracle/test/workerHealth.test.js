const assert = require("node:assert/strict");
const test = require("node:test");
const { isWorkerReady } = require("../workerHealth");

const now = Date.parse("2026-10-16T03:00:00.000Z");
const healthy = {
  enabled: true,
  pollIntervalMs: 15_000,
  now,
  state: {
    initialized: true,
    lastError: "",
    lastSuccessfulPollAt: new Date(now - 1_000).toISOString(),
  },
};

test("worker readiness requires a successful recent poll", () => {
  assert.equal(isWorkerReady(healthy), true);
  assert.equal(isWorkerReady({ ...healthy, state: { ...healthy.state, lastSuccessfulPollAt: null } }), false);
  assert.equal(isWorkerReady({ ...healthy, now: now + 60_000 }), false);
});

test("worker readiness fails during polling errors and recovers after a successful poll", () => {
  const state = { ...healthy.state, lastError: "private RPC failure detail" };
  assert.equal(isWorkerReady({ ...healthy, state }), false);
  state.lastError = "";
  state.lastSuccessfulPollAt = new Date(now).toISOString();
  assert.equal(isWorkerReady({ ...healthy, state }), true);
});

test("disabled or uninitialized workers are never ready", () => {
  assert.equal(isWorkerReady({ ...healthy, enabled: false }), false);
  assert.equal(isWorkerReady({ ...healthy, state: { ...healthy.state, initialized: false } }), false);
});
