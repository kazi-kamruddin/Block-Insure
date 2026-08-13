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
