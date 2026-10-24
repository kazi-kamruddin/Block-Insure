const test = require("node:test"), assert = require("node:assert/strict");
const { ethers } = require("ethers");
const load = require("./helpers/loadIsolatedModule");
const fixture = require("./helpers/shadowFixture");
const { signedMessage, hash, assessShadowPacket } = require("../../oracle/shadowAssessment");
function service(f) {
  const claim = { ...f.authoritative.claim, claimAmount: ethers.parseEther("0.1"), toObject() { return { ...this, toObject: undefined }; } };
  const provider = { getNetwork: async () => ({ chainId: 31337n }), getBlock: async (n) => ({ number: n === "latest" ? 12 : n, hash: n === 5 ? f.authoritative.requestBlockHash : ethers.id(String(n === "latest" ? 12 : n)) }), destroy() {} };
  const manager = { runner: { provider }, getAddress: async () => f.authoritative.managerAddress, ORACLE_ROLE: async () => ethers.id("ORACLE_ROLE"),
    hasRole: async () => true, getClaim: async () => claim, claimVersion: async () => 1n };
  const coordinator = { getAddress: async () => f.authoritative.coordinatorAddress, getRequest: async () => f.authoritative.request,
    eligibleForRequest: async () => true, getRegistrySnapshot: async () => ({ root: f.authoritative.request.registryRoot, publishedAt: f.authoritative.snapshotTimestamp }) };
  const rows = new Map();
  const result = load("services/oracleShadowService.js", {
    "./contractService": { getReadOnlyContract: () => manager, getOracleCoordinator: async () => coordinator },
    "./xgboostAdvisoryService": { loadAdvisoryBundle: () => f.loaded, readCommittedRecords: async () => [f.record] },
    "../models/OracleShadowAssessment": { updateOne: async (filter, update) => { if (!rows.has(filter._id)) rows.set(filter._id, update.$setOnInsert); },
      find: () => ({ limit: () => ({ lean: async () => [...rows.values()] }) }) },
  });
  return { ...result, manager, coordinator, rows };
}
async function auth(f, action = "CONTEXT", extra = {}) {
  const timestamp = Date.now(), report = extra.report, metrics = extra.metrics;
  return { requestId: "1", oracleWallet: f.wallet.address, oracleInstanceId: "1", timestamp,
    signature: await f.wallet.signMessage(signedMessage({ action, requestId: 1, wallet: f.wallet.address, timestamp, chainId: 31337,
      coordinatorAddress: f.authoritative.coordinatorAddress, digest: action === "REPORT" ? hash({ report, metrics }) : "" })), ...extra };
}
test("eligible signed workers receive immutable request-bound canonical context", async () => {
  const f = fixture(), s = service(f), packet = await s.getPacket(await auth(f));
  assert.deepEqual(packet, f.packet);
  assert.equal(Object.hasOwn(packet.records[0], "sourceBeneId"), false);
});
test("worker role, eligibility, stale timestamps and stale claim versions are enforced", async () => {
  const f = fixture(), s = service(f);
  await assert.rejects(s.getPacket({ ...await auth(f), timestamp: 1 }), (e) => e.statusCode === 401);
  await assert.rejects(s.getPacket({ ...await auth(f), requestId: "2" }), (e) => e.statusCode === 401);
  s.manager.hasRole = async () => false;
  await assert.rejects(s.getPacket(await auth(f)), (e) => e.statusCode === 403);
  s.manager.hasRole = async () => true; s.coordinator.eligibleForRequest = async () => false;
  await assert.rejects(s.getPacket(await auth(f)), (e) => e.statusCode === 403);
  s.coordinator.eligibleForRequest = async () => true; s.manager.claimVersion = async () => 2n;
  await assert.rejects(s.getPacket(await auth(f)), (e) => e.statusCode === 409);
});
test("reports are signed, recomputed and immutable; metrics are inside authorization", async () => {
  const f = fixture(), s = service(f), assessed = assessShadowPacket(f.packet, f.authoritative);
  const report = Object.fromEntries(["contextId", "result", "resultHash", "contextHash", "explanationHash"].map((k) => [k, assessed[k]]));
  const metrics = { totalMs: 20, scoringMs: 2, rssBytes: 60000000, heapUsedBytes: 20000000 };
  const input = await auth(f, "REPORT", { report, metrics });
  assert.equal((await s.saveReport(input)).accepted, true);
  assert.equal((await s.saveReport(input)).accepted, true); assert.equal(s.rows.size, 1);
  await assert.rejects(s.saveReport({ ...input, metrics: { ...metrics, totalMs: 1 } }), (e) => e.statusCode === 401);
  const altered = { ...report, resultHash: "0".repeat(64) };
  await assert.rejects(s.saveReport(await auth(f, "REPORT", { report: altered, metrics })), (e) => e.statusCode === 409);
});
test("worker authentication cannot substitute another wallet or purpose", async () => {
  const f = fixture(), s = service(f);
  await assert.rejects(s.getPacket({ ...await auth(f), oracleWallet: ethers.Wallet.createRandom().address }), (e) => e.statusCode === 401);
  await assert.rejects(s.getPacket(await auth(f, "REPORT", { report: {}, metrics: {} })), (e) => e.statusCode === 401);
});
test("malformed reports and signatures fail before inference or persistence", async () => {
  const f = fixture(), s = service(f);
  await assert.rejects(s.getPacket({ ...await auth(f), signature: "broken" }), (e) => e.statusCode === 401);
  await assert.rejects(s.saveReport({ report: { result: {} }, metrics: {} }), (e) => e.statusCode === 400);
  assert.equal(s.rows.size, 0);
});
test("shadow controller errors never serialize records, signatures or diagnostics", async () => {
  const controller = load("controllers/oracleShadowController.js", { "../services/oracleShadowService": { getPacket: async () => { throw new Error("private source record"); } } });
  let failure;
  await controller.getShadowPacket({ body: {} }, { set: () => {} }, (e) => { failure = e; });
  assert.equal(failure.statusCode, 503); assert.equal(failure.message.includes("private"), false);
});
