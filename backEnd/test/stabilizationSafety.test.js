const test = require("node:test");
const assert = require("node:assert/strict");
const { ethers } = require("ethers");
const load = require("./helpers/loadIsolatedModule");
const { assertAppealFactsMatch } = require("../services/appealFactService");
const { extractRuntimeFeatures } = require("../services/featureEngineeringService");
const { analyzeDuplicateCandidate } = require("../services/duplicateIntelligenceService");

test("appeals reject off-chain corrections not reflected in the authoritative claim", () => {
  const claim = { hospitalId: "HOSP-001", claimType: "SURGERY", claimAmount: ethers.parseEther("0.1"), invoiceHash: ethers.id("INV-1") };
  assert.doesNotThrow(() => assertAppealFactsMatch(claim, { proposedClaimAmountEth: "0.100", proposedInvoiceNumber: "INV-1" }));
  for (const correction of [{ proposedClaimAmountEth: "0.01" }, { proposedInvoiceNumber: "INV-2" }, { proposedHospitalId: "HOSP-002" }, { proposedClaimType: "OTHER" }]) {
    assert.throws(() => assertAppealFactsMatch(claim, correction), { statusCode: 409 });
  }
});

test("runtime feature extraction ignores evaluation labels and synthetic mutation markers", () => {
  const record = { billAmount: "0.1", expectedBillMin: "0.01", expectedBillMax: "1", recordStatus: "VALID", invoiceStatus: "VALID", licenseStatus: "ACTIVE" };
  const extract = (input) => extractRuntimeFeatures({ record: input, comparison: {} });
  assert.deepEqual(extract(record), extract({ ...record, fraudLabel: "FRAUD", actualFraud: true, fraudSignals: { inflatedAmount: true, dateMismatch: true, usedInvoice: true, blacklistedHospital: true } }));
});

test("different patients at the same provider are not fuzzy duplicate claims", () => {
  const candidate = { claimantId: "patient-a", providerName: "Hospital", invoiceNumber: "INV-1", documentText: "routine treatment", incidentDate: "2026-10-01", amount: 100 };
  const result = analyzeDuplicateCandidate(candidate, [{ ...candidate, claimantId: "patient-b", invoiceNumber: "INV-2", claimId: "2" }]);
  assert.equal(result.requiresManualReview, false);
  assert.equal(result.authority, "ADVISORY_ONLY");
});

test("normal attachment and interrupted recovery share idempotent evidence finalization", async () => {
  const events = new Map();
  const file = { _id: "doc", envelopeClaimId: "attempt:attempt-a", claimVersion: 1, uploaderWallet: "0xowner", sha256Hash: "abc", ipfsCID: "cid", save: async () => {} };
  const service = load("services/evidenceFinalizationService.js", {
    "./evidenceChainService": { assignEvidenceChainLink: async (record, id) => { record.claimId = id; return record; } },
    "./evidenceTransparencyService": { appendEvidenceEvent: async (event) => { if (!events.has(event.idempotencyKey)) events.set(event.idempotencyKey, { treeIndex: 0 }); return events.get(event.idempotencyKey); } },
  });
  const args = { file, claim: { claimId: 17n, policyId: 2n, documentHash: "0xabc", documentCID: "cid" }, version: 1, attempt: { _id: "attempt-a", policyId: "2", documentId: "doc" }, actorWallet: "0xowner" };
  await service.finalizeEvidence(args);
  await service.finalizeEvidence(args);
  assert.equal(file.evidenceEventIndex, 0);
  assert.equal(events.size, 1);
  await assert.rejects(service.finalizeEvidence({ ...args, attempt: { ...args.attempt, _id: "other-attempt" } }), { statusCode: 409 });
  await assert.rejects(service.finalizeEvidence({ ...args, version: 2 }), { statusCode: 409 });
  await assert.rejects(service.finalizeEvidence({ ...args, claim: { ...args.claim, documentHash: "0xdifferent" } }), { statusCode: 409 });
});

test("mined package updates return success without publishing fictitious economic changes", async () => {
  let mined = false;
  const controller = load("controllers/adminController.js", {
    "../services/contractService": { getAdminContract: () => ({
      updatePolicyPackage: async () => ({ hash: "0xtx", wait: async () => { mined = true; return {}; } }),
      getPolicyPackage: async () => ({ packageId: 1n, name: "Health", policyType: "HEALTH", premiumAmount: 1n, coverageAmount: 10n, durationDays: 365n, requiredDocumentType: "BILL", isActive: true }),
    }) },
    "../services/adminActionLogService": { logAdminAction: async () => {} },
  });
  let payload;
  const res = { status: (code) => { assert.equal(code, 200); return res; }, json: (value) => { payload = value; } };
  await controller.updatePolicyPackage({ params: { id: "1" }, body: { name: "Health", policyType: "HEALTH", premiumAmountEth: "0.01", coverageAmountEth: "1", durationDays: 365, requiredDocumentType: "BILL" } }, res, (error) => { throw error; });
  assert.equal(mined, true);
  assert.equal(payload.success, true);
  assert.equal(payload.transactionHash, "0xtx");
  assert.equal(payload.economicsTransactionHash, "");
});
