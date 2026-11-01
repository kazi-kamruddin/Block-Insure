const test = require("node:test"), assert = require("node:assert/strict");
const fixture = require("../../backEnd/test/helpers/shadowFixture");
const { assessShadowPacket, registryRoot, createShadowRunner, signedMessage, hash } = require("../shadowAssessment");
const { buildMerkleTree, getCanonicalRecordPayload } = require("../../backEnd/services/merkleRegistryService");
test("independent worker reconstructs complete canonical roots and deterministic assessment", () => {
  const { packet, authoritative } = fixture();
  const a = assessShadowPacket(packet, authoritative), b = assessShadowPacket(structuredClone(packet), structuredClone(authoritative));
  assert.deepEqual(a, b);
  assert.equal(a.resultHash, hash(a.result));
  for (const size of [1, 2, 3, 7]) {
    const records = Array.from({ length: size }, (_, i) => ({ ...packet.records[0], invoiceHash: `0x${String(i + 1).padStart(64, "0")}`, invoiceNumber: `inv-${i}` }));
    assert.equal(registryRoot(records.map(getCanonicalRecordPayload)), buildMerkleTree(records).rootHash);
  }
});
test("worker rejects tampered, missing and mismatched context before scoring", () => {
  const { packet, authoritative } = fixture();
  for (const change of [
    { ...packet, contextId: "tampered" }, { ...packet, records: [] },
    { ...packet, records: [{ ...packet.records[0], billAmount: "999" }] },
    { ...packet, binding: { ...packet.binding, claimVersion: "2" } },
  ]) assert.throws(() => assessShadowPacket(change, authoritative));
  assert.throws(() => assessShadowPacket(packet, { ...authoritative, requestBlockHash: "other-deployment" }));
  assert.throws(() => assessShadowPacket(packet, { ...authoritative, claim: { ...authoritative.claim, claimAmountEth: "0.2" } }));
});
test("shadow failures are retried, coalesced and never escape to protocol callers", async () => {
  let failures = 0, attempts = 0;
  const runner = createShadowRunner({ run: async () => { if (++attempts === 1) throw new Error("Unavailable model"); }, onFailure: () => failures++ });
  await runner([{ requestId: 1 }]); await runner([{ requestId: 1 }]); await runner([{ requestId: 1 }]);
  assert.equal(failures, 1); assert.equal(attempts, 2);
});
test("bounded backfill progresses beyond completed and persistently failed first rows", async () => {
  const visited = new Set();
  const runner = createShadowRunner({ run: async (r) => { visited.add(r.requestId); if (r.requestId <= 8) throw new Error("Missing invoice"); } });
  const requests = Array.from({ length: 24 }, (_, i) => ({ requestId: i + 1 }));
  for (let i = 0; i < 8; i++) await runner(requests);
  assert.equal(visited.size, 24);
});
test("request identity changes after reorg trigger a fresh shadow report", async () => {
  let calls = 0;
  const runner = createShadowRunner({ run: async () => { calls++; } });
  await runner([{ requestId: 1, shadowBlockHash: "old" }]);
  await runner([{ requestId: 1, shadowBlockHash: "new" }]); assert.equal(calls, 2);
});
test("authorization purpose, chain, coordinator and report digest are separated", () => {
  const base = { action: "CONTEXT", requestId: 1, wallet: `0x${"1".repeat(40)}`, timestamp: Date.now(), chainId: 31337, coordinatorAddress: `0x${"2".repeat(40)}` };
  const original = signedMessage(base);
  for (const change of [{ action: "REPORT" }, { digest: "different" }, { chainId: 1 }, { requestId: 2 }, { coordinatorAddress: `0x${"3".repeat(40)}` }]) assert.notEqual(signedMessage({ ...base, ...change }), original);
});
