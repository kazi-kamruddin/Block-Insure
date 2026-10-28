const test = require("node:test");
const assert = require("node:assert/strict");
const { buildManifest } = require("../services/evidenceBundleService");
const load = require("./helpers/loadIsolatedModule");
const file = (id, type = "SUPPORTING_DOCUMENT") => ({ _id: id, claimVersion: 1, documentType: type,
  sha256Hash: `hash-${id}`, ipfsCID: `cid-${id}`, associatedDataHash: `aad-${id}`, encryptionSchemeVersion: "RECRYPT-RS-0.15+A256GCM" });
test("evidence manifests bind deployment, version, order and every ciphertext without rewriting source envelopes", () => {
  const base = { deploymentScope: "deployment-A", claimId: "1", claimVersion: 2, documents: [file("primary", "HOSPITAL_BILL"), file("support")] };
  const first = buildManifest(base);
  assert.deepEqual(buildManifest(structuredClone(base)), first);
  for (const patch of [{ deploymentScope: "deployment-B" }, { claimVersion: 3 }, { claimId: "2" },
    { documents: [base.documents[0], { ...base.documents[1], sha256Hash: "different" }] },
    { documents: [base.documents[0], file("another"), base.documents[1]] }]) {
    assert.notEqual(buildManifest({ ...base, ...patch }).manifestHash, first.manifestHash);
  }
  assert.equal(JSON.parse(first.manifest).documents[0].sourceClaimVersion, 1);
  assert.throws(() => buildManifest({ ...base, documents: [file("not-primary")] }));
  assert.throws(() => buildManifest({ ...base, documents: [] }));
  assert.throws(() => buildManifest({ ...base, documents: [base.documents[0], ...Array.from({ length: 7 }, (_, i) => file(String(i)))] }));
});
test("batch access rejects another owner, stale manifests and missing or excessive grant entries before writing", async () => {
  const wallets = [1, 2, 3, 4].map((n) => `0x${String(n).padStart(40, "0")}`);
  const owner = `0x${"a".repeat(40)}`;
  const manager = { getClaim: async () => ({ claimantWallet: owner }), claimVersion: async () => 1n };
  const adjudicator = { getReview: async () => ({ auditors: wallets, deadline: 0n }), getPreparation: async () => ({ deadline: 100n }) };
  const service = load("services/reviewAccessService.js", {
    "../models/User": { findOne: () => ({ select: () => ({ lean: async () => null }) }) },
    "../models/EvidenceGrant": { find: () => ({ select: () => ({ lean: async () => [] }) }) },
    "../models/File": { find: () => { throw new Error("No file query expected before validation"); } },
    "./contractService": { getReadOnlyContract: () => manager, getClaimAdjudicator: async () => adjudicator },
    "./evidenceBundleService": { getBundle: async () => ({ deploymentScope: "scope", manifestHash: "manifest", documentIds: ["primary"] }),
      fail: (message, statusCode = 409) => Object.assign(new Error(message), { statusCode }) },
  });
  await assert.rejects(service.prepareBatch("1", wallets[0], {}), (e) => e.statusCode === 403);
  await assert.rejects(service.prepareBatch("1", owner, { claimVersion: 2, manifestHash: "manifest" }), /version changed/);
  await assert.rejects(service.prepareBatch("1", owner, { claimVersion: 1, manifestHash: "manifest", grants: [] }), /exactly/);
  await assert.rejects(service.prepareBatch("1", owner, { claimVersion: 1, manifestHash: "manifest", grants: Array(29).fill({}) }), /exactly/);
  await assert.rejects(service.prepareBatch("1", owner, { claimVersion: 1, manifestHash: "manifest", grants: Array(4).fill(null) }), (e) => e.statusCode === 422);
});

test("appeal recovery retains unknown transactions and only reopens an exact canonically reverted unchanged version", async () => {
  const { Interface, id } = require("ethers");
  const owner = `0x${"a".repeat(40)}`, target = `0x${"b".repeat(40)}`;
  const hash = id("failed-appeal"), reasonHash = id("sealed-reason");
  let saves = 0, version = 1n, network = 31337n, canonical = true, unknown = true;
  const attempt = { _id: "123456789012345678901234", claimId: "1", claimVersion: 2, ownerWallet: owner,
    payload: { claimId: "1", appealReason: "sealed reason" }, appealReasonHash: reasonHash,
    transactionHash: hash, status: "TX_SUBMITTED", save: async () => { saves++; } };
  const abi = new Interface(["function submitAppeal(uint256 claimId, bytes32 reasonHash)"]);
  let from = owner;
  const manager = { target, interface: abi, getClaim: async () => ({ status: 8 }), claimVersion: async () => version,
    runner: { getTransactionReceipt: async () => unknown ? null : ({ status: 0, blockNumber: 100, blockHash: "canonical" }),
      getTransaction: async () => ({ from, to: target, data: abi.encodeFunctionData("submitAppeal", [1, reasonHash]), value: 0n }),
      getNetwork: async () => ({ chainId: network }), getBlockNumber: async () => 100,
      getBlock: async () => ({ hash: canonical ? "canonical" : "different" }) } };
  const controller = load("controllers/appealAttemptController.js", {
    "../models/AppealSubmissionAttempt": { findOne: () => ({ select: async () => attempt }) },
    "../services/contractService": { getReadOnlyContract: () => manager },
    "../services/evidenceBundleService": { assertEvidenceDeployment: async () => "scope",
      fail: (message, statusCode = 409) => Object.assign(new Error(message), { statusCode }) },
    "./appealController": { registerConfirmedAppeal: () => { throw Error("Failed transactions cannot register appeals"); } },
  });
  const req = { params: { attemptId: String(attempt._id) }, user: { walletAddress: owner, role: "USER" } };
  let body, error;
  const res = { status() { return this; }, json(value) { body = value; return this; } };
  const recover = async () => { body = null; error = null; await controller.reconcile(req, res, (value) => { error = value; }); };
  await recover(); assert.equal(body.pending, true); assert.equal(attempt.transactionHash, hash);
  unknown = false; from = target;
  await recover(); assert.equal(error.statusCode, 403); assert.equal(saves, 0);
  from = owner; canonical = false;
  await recover(); assert.equal(body.pending, true); assert.equal(saves, 0);
  canonical = true; network = 11155111n;
  await recover(); assert.equal(body.pending, true); assert.equal(saves, 0);
  network = 31337n; version = 2n;
  await recover(); assert.match(error.message, /version changed/); assert.equal(saves, 0);
  version = 1n;
  await recover(); assert.equal(error, null); assert.equal(body.retryable, true); assert.equal(saves, 1);
  assert.equal(attempt.status, "READY"); assert.equal(attempt.transactionHash, "");
  assert.equal(attempt.lastRevertedTransactionHash, hash); assert.equal(attempt.appealReasonHash, reasonHash);
});
