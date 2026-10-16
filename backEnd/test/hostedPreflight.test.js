const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeUrl, validateResponses } = require("../../scripts/hostedPreflight");

const preview = () => ({
  frontend: { body: "<title>Block-Insure</title>" },
  backend: { body: { success: true, status: "limited" } },
  oracleOne: { body: { success: true, status: "alive", oracleInstanceId: "1", workerEnabled: false } },
  oracleTwo: { body: { success: true, status: "alive", oracleInstanceId: "2", workerEnabled: false } },
});

test("hosted preflight accepts dormant preview workers and rejects duplicated Oracle identities", () => {
  const responses = preview();
  assert.doesNotThrow(() => validateResponses(responses));
  responses.oracleTwo = responses.oracleOne;
  assert.throws(() => validateResponses(responses), /Oracle 2 liveness/);
});

test("hosted preflight distinguishes enabled Oracle readiness from liveness", () => {
  const responses = preview();
  responses.oracleOne.body.workerEnabled = true;
  assert.throws(() => validateResponses(responses), /enabled but is not ready/);
  responses.oracleOne.body.status = "ready";
  assert.doesNotThrow(() => validateResponses(responses));
});

test("hosted preflight rejects loopback IPv6 and URL credentials", () => {
  assert.throws(() => normalizeUrl("backend", "https://[::1]"), /loopback/);
  assert.throws(() => normalizeUrl("backend", "https://user:synthetic@example.test"), /credentials/);
  assert.equal(normalizeUrl("backend", "https://example.test/"), "https://example.test");
});
