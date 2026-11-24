const test = require("node:test");
const assert = require("node:assert/strict");
const load = require("./helpers/loadIsolatedModule");

test("clarification notifications are stage-specific, deployment-scoped and idempotent", async () => {
  const entries = new Map();
  const { notifyClarification } = load("services/notificationService.js", {
    "../models/Notification": { findOneAndUpdate: async (match, update, options) => {
      assert.equal(options.upsert, true);
      if (!entries.has(match.dedupeKey)) entries.set(match.dedupeKey, update.$setOnInsert);
      return entries.get(match.dedupeKey);
    } },
    "./contractService": {},
  });
  const record = { scope: "deployment1", claimId: "7", priorVersion: 2, owner: "0x" + "b".repeat(40) };
  for (const stage of ["ASKED", "ANSWERED", "EXPIRED"]) {
    const first = await notifyClarification(record, stage);
    assert.equal(await notifyClarification(record, stage), first);
    assert.equal(first.type, "CLARIFICATION_" + stage);
    assert.equal(first.recipientWallet, stage === "ASKED" ? record.owner : "");
    assert.equal(first.recipientRole, stage === "ASKED" ? "" : "ADMIN");
  }
  await notifyClarification({ ...record, scope: "deployment2" }, "ASKED");
  assert.equal(entries.size, 4);
});

test("expiry uses the chain clock and suppresses notices for a mined answer awaiting reconciliation", async () => {
  const confirmedHash = "0x" + "a".repeat(64);
  const records = [
    { _id: "open", scope: "current", claimId: "10", priorVersion: 1, manifestHash: null },
    { _id: "mined", scope: "current", claimId: "11", priorVersion: 1, manifestHash: confirmedHash },
  ];
  const notices = [], updates = [];
  const provider = { getBlock: async () => ({ number: 35, timestamp: 900 }), destroy() {} };
  const { notifyExpiredClarifications } = load("services/notificationService.js", {
    ethers: { ethers: { Contract: class { async clarificationEvidence(claimId, version, opts) {
      assert.deepEqual([claimId, version, opts.blockTag], ["11", 2, 35]);
      return confirmedHash;
    } } } },
    "./contractService": { getReadOnlyContract: () => ({ runner: { provider }, claimAdjudicator: async () => "selected-panel" }) },
    "../models/Notification": { findOneAndUpdate: async (_match, update) => {
      notices.push(update.$setOnInsert); return update.$setOnInsert;
    } },
    "../models/ClaimClarification": {
      exists: async (criteria) => { assert.equal(criteria.scope, "current"); return true; },
      find: (criteria) => {
        assert.deepEqual(criteria, { scope: "current", confirmed: false, deadlineNoticeAt: null, deadline: { $lt: 900 } });
        return { sort: () => ({ limit: async () => records }) };
      },
      updateOne: async (criteria) => updates.push(criteria._id),
    },
  });
  await notifyExpiredClarifications("current");
  assert.deepEqual(notices.map(({ claimId, recipientRole, type }) => [claimId, recipientRole, type]), [["10", "ADMIN", "CLARIFICATION_EXPIRED"]]);
  assert.deepEqual(updates, ["open", "mined"]);
});
