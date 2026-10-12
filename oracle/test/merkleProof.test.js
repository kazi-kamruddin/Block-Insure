const assert = require("node:assert/strict");
const test = require("node:test");
const { hashPair, hashCanonicalRecord, verifyRegistryProof } = require("../merkleProof");

const canonicalRecord = {
  hospitalId: "HOSP-001",
  hospitalName: "Synthetic Hospital",
  licenseStatus: "ACTIVE",
  patientHash: "0xpatient",
  treatmentType: "SURGERY",
  diagnosisCode: "D-1",
  admissionDate: "2026-01-01T00:00:00.000Z",
  dischargeDate: "2026-01-02T00:00:00.000Z",
  invoiceDate: "2026-01-02T00:00:00.000Z",
  billAmount: "1000",
  expectedBillMin: "900",
  expectedBillMax: "1100",
  invoiceNumber: "INV-001",
  invoiceHash: "0xabcdef",
  invoiceStatus: "PAID",
  recordStatus: "VERIFIED",
  fraudLabel: "CLEAN",
};

test("reconstructs the canonical leaf before verifying a valid path", () => {
  const leftLeaf = hashCanonicalRecord(canonicalRecord);
  const rightLeaf = hashCanonicalRecord({ ...canonicalRecord, invoiceNumber: "INV-002" });
  const rootHash = hashPair(leftLeaf, rightLeaf);

  assert.equal(
    verifyRegistryProof({
      found: true,
      canonicalRecord,
      leafHash: leftLeaf,
      rootHash,
      proof: [{ position: "right", siblingHash: rightLeaf }],
    }),
    true
  );
});

test("rejects a proof whose canonical record was tampered with", () => {
  const leftLeaf = hashCanonicalRecord(canonicalRecord);
  const rightLeaf = hashCanonicalRecord({ ...canonicalRecord, invoiceNumber: "INV-002" });

  assert.equal(
    verifyRegistryProof({
      found: true,
      canonicalRecord: { ...canonicalRecord, billAmount: "999999" },
      leafHash: leftLeaf,
      rootHash: hashPair(leftLeaf, rightLeaf),
      proof: [{ position: "right", siblingHash: rightLeaf }],
    }),
    false
  );
});

test("binds hybrid provenance and verdict-relevant risk metadata to the proof", () => {
  const hybridRecord = {
    ...canonicalRecord,
    datasetProfile: "blockinsure-hybrid-v1.2.0",
    baseDataOrigin: "PUBLIC_SECONDARY",
    claimSetting: "OUTPATIENT",
    providerPotentialFraud: true,
    providerLabelType: "POTENTIAL_PROVIDER_FRAUD",
    scenarioInjected: false,
    scenarioType: "NONE",
    scenarioVersion: "none",
    sourceClaimAmountUsd: 2450,
    sourceProcedureCode: "99214",
    amountNormalizationVersion: "usd-to-eth-v1",
    amountNormalizationDivisor: 10000,
    previousClaimCount: 2,
    providerVelocityAnomaly: false,
    claimantVelocityAnomaly: true,
    nearDuplicateAdvisory: false,
    isMissingOrNoisy: false,
    dataQuality: "COMPLETE",
    recurringLegitimate: true,
    fraudSignals: {
      usedInvoice: false,
      cancelledRecord: false,
      inflatedAmount: false,
      blacklistedHospital: false,
      dateMismatch: false,
    },
  };
  const leafHash = hashCanonicalRecord(hybridRecord);

  assert.equal(
    verifyRegistryProof({
      found: true,
      canonicalRecord: { ...hybridRecord, providerPotentialFraud: false },
      leafHash,
      rootHash: leafHash,
      proof: [],
    }),
    false
  );
});

test("rejects a tampered Merkle path", () => {
  const leftLeaf = hashCanonicalRecord(canonicalRecord);
  const rightLeaf = hashCanonicalRecord({ ...canonicalRecord, invoiceNumber: "INV-002" });

  assert.equal(
    verifyRegistryProof({
      found: true,
      canonicalRecord,
      leafHash: leftLeaf,
      rootHash: hashPair(leftLeaf, rightLeaf),
      proof: [{ position: "right", siblingHash: hashCanonicalRecord({}) }],
    }),
    false
  );
});
