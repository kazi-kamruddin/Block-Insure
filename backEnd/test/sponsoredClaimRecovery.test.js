const test = require("node:test");
const assert = require("node:assert/strict");
const { Interface, id } = require("ethers");
const load = require("./helpers/loadIsolatedModule");
const { resolveSubmittedClaim } = require("../services/claimSubmissionIntegrityService");
const iface = new Interface(require("../abi/InsuranceManager.json").abi);
const owner = `0x${"a".repeat(40)}`, manager = `0x${"b".repeat(40)}`, other = `0x${"c".repeat(40)}`;
const facts = { incidentDate: "1000", claimAmountWei: "20000", claimType: "HOSPITALIZATION", hospitalId: "HOSP-001", invoiceHash: id("invoice") };
function fixture() {
  const attempt = { _id: "123456789012345678901234", deploymentScope: "scope", policyId: "3", walletAddress: owner,
    submittedFacts: facts, transactionHash: id("sponsored"), documentId: "invoice-file", status: "TX_SUBMITTED", save: async () => {} };
  const file = { sha256Hash: id("encrypted-document").slice(2), ipfsCID: "synthetic-ciphertext-cid" };
  const claim = { claimId: 4n, policyId: 3n, claimantWallet: owner, incidentDate: 1000n, claimAmount: 20000n,
    claimType: facts.claimType, hospitalId: facts.hospitalId, invoiceHash: facts.invoiceHash, documentHash: `0x${file.sha256Hash}`, documentCID: file.ipfsCID };
  const event = (claimId = 4n, wallet = owner, policyId = 3n, address = manager) => ({ address,
    ...iface.encodeEventLog(iface.getEvent("ClaimSubmitted"), [claimId, policyId, wallet, 20000n]) });
  const receipt = { status: 1, logs: [event()] };
  const contract = { getAddress: async () => manager, interface: iface, getClaim: async () => claim,
    runner: { getTransactionReceipt: async () => receipt,
      getTransaction: async () => ({ from: other, to: other }) } };
  return { attempt, file, claim, receipt, contract, event, walletAddress: owner };
}

test("controller reconciles a sponsored receipt without requiring outer relayer addresses to be the claimant/manager", async () => {
  const f = fixture(); let finalized = 0, bundled = 0, error, response;
  const controller = load("controllers/claimController.js", {
    "../models/ClaimSubmissionAttempt": { findOne: async () => f.attempt },
    "../models/File": { findById: async () => f.file },
    "../services/contractService": { getReadOnlyContract: () => f.contract },
    "../services/evidenceBundleService": { assertEvidenceDeployment: async () => "scope", finalizeAttemptBundle: async () => { bundled++; } },
    "../services/evidenceFinalizationService": { finalizeEvidence: async () => { finalized++; } },
    "../services/notificationService": { notifyAdmins: async () => {} },
  });
  await controller.reconcileClaimSubmission({ params: { attemptId: f.attempt._id }, user: { walletAddress: owner } },
    { status() { return this; }, json(v) { response = v; return this; } }, e => { error = e; });
  assert.equal(error, undefined); assert.equal(response.attempt.claimId, "4");
  assert.equal(f.attempt.status, "COMPLETED"); assert.equal(finalized, 1); assert.equal(bundled, 1);
});

test("a batch skips an unrelated earlier event and recovers the exact claim", async () => {
  const f = fixture(); f.receipt.logs.unshift(f.event(99n, other));
  assert.equal((await resolveSubmittedClaim(f)).claimId, "4");
});

for (const [name, change] of [
  ["forged event emitter", f => { f.receipt.logs = [f.event(4n, owner, 3n, other)]; }],
  ["another event claimant", f => { f.receipt.logs = [f.event(4n, other)]; }],
  ["another event policy", f => { f.receipt.logs = [f.event(4n, owner, 9n)]; }],
  ["another stored claimant", f => { f.claim.claimantWallet = other; }],
  ["another stored policy", f => { f.claim.policyId = 9n; }],
  ["changed submitted facts", f => { f.claim.claimAmount = 20001n; }],
  ["wrong encrypted document hash", f => { f.claim.documentHash = id("other-file"); }],
  ["wrong encrypted document CID", f => { f.claim.documentCID = "other-cid"; }],
  ["reverted receipt", f => { f.receipt.status = 0; }],
]) test(`receipt recovery rejects ${name}`, async () => {
  const f = fixture(); change(f);
  await assert.rejects(resolveSubmittedClaim(f), e => [403, 409].includes(e.statusCode));
});

test("ambiguous matching claims cannot silently select the first", async () => {
  const f = fixture(); f.receipt.logs.push(f.event(5n));
  await assert.rejects(resolveSubmittedClaim(f), /multiple matching/);
});

test("direct wallet submissions retain the same successful reconciliation", async () => {
  const f = fixture(); f.contract.runner.getTransaction = async () => ({ from: owner, to: manager });
  assert.equal((await resolveSubmittedClaim(f)).claimId, "4");
});
