const assert = require("node:assert/strict");
const test = require("node:test");
const modelArtifact = require("../../backEnd/model-params.json");
const triagePolicy = require("../../backEnd/triage-policy.json");
const { independentlyAssessRecord } = require("../independentAssessment");

const record = {
  authorizedClaimants: ["0x0000000000000000000000000000000000000001"],
  hospitalId: "PRV-1",
  invoiceHash: "0xabc",
  billAmount: "1.0000",
  expectedBillMin: "0.5000",
  expectedBillMax: "1.5000",
  treatmentType: "DIAGNOSTIC",
  admissionDate: "2026-01-01T00:00:00.000Z",
  dischargeDate: "2026-01-02T00:00:00.000Z",
  invoiceDate: "2026-01-02T00:00:00.000Z",
  recordStatus: "VALID",
  invoiceStatus: "VALID",
  licenseStatus: "ACTIVE",
  fraudLabel: "LEGITIMATE",
  previousClaimCount: 0,
  providerVelocityAnomaly: false,
  claimantVelocityAnomaly: false,
  nearDuplicateAdvisory: false,
  isMissingOrNoisy: false,
  dataQuality: "COMPLETE",
  fraudSignals: {},
};
const claim = {
  claimantWallet: "0x0000000000000000000000000000000000000001",
  hospitalId: "PRV-1",
  invoiceHash: "0xabc",
  claimAmountEth: "0.8",
  claimType: "DIAGNOSTIC",
  incidentDate: String(Date.parse("2026-01-01T00:00:00.000Z") / 1000),
};

test("oracle independently verifies a clean proof-bound record", () => {
  const result = independentlyAssessRecord({ record, claim, modelArtifact, triagePolicy });
  assert.equal(result.verified, true);
  assert.equal(result.verificationCode, "VERIFIED");
});

test("oracle rejects proof-bound risk facts without trusting backend verdicts", () => {
  const result = independentlyAssessRecord({
    record: { ...record, invoiceStatus: "USED", fraudSignals: { usedInvoice: true } },
    claim,
    modelArtifact,
    triagePolicy,
  });
  assert.equal(result.verified, false);
  assert.equal(result.features.used_invoice, true);
  assert.equal(result.verificationCode, "PROOF_BOUND_INTEGRITY_REJECTED");
});

test("evaluation labels and injected markers do not determine runtime verification", () => {
  const assess = (input) => independentlyAssessRecord({ record: input, claim, modelArtifact, triagePolicy });
  const baseline = assess(record);
  const changed = assess({ ...record, fraudLabel: "INFLATED_AMOUNT", fraudSignals: { inflatedAmount: true, dateMismatch: true, blacklistedHospital: true } });
  assert.equal(changed.verified, baseline.verified);
  assert.deepEqual(changed.features, baseline.features);
  assert.equal(changed.fraudProbability, baseline.fraudProbability);
});

test("an unrelated claimant cannot verify another patient's invoice", () => {
  const result = independentlyAssessRecord({ record, claim: { ...claim, claimantWallet: "0x0000000000000000000000000000000000000002" }, modelArtifact, triagePolicy });
  assert.equal(result.verified, false);
  assert.equal(result.comparison.patientMatches, false);
});
