const test = require("node:test");
const assert = require("node:assert/strict");
const { ethers } = require("ethers");

const {
  buildHospitalVerificationAssessment,
} = require("../services/hospitalVerificationService");

const claim = {
  claimId: 7n,
  claimantWallet: "0x0000000000000000000000000000000000000001",
  claimAmount: ethers.parseEther("0.1"),
  incidentDate: BigInt(Date.parse("2026-08-10T12:00:00Z") / 1000),
  claimType: "HOSPITALIZATION",
  hospitalId: "HOSP-001",
  invoiceHash: ethers.keccak256(ethers.toUtf8Bytes("INV-001")),
};
const hospital = {
  hospitalId: "HOSP-001",
  walletAddress: "0x0000000000000000000000000000000000000010",
};
const record = {
  authorizedClaimants: [claim.claimantWallet],
  _id: { toString: () => "record-1" },
  hospitalId: "HOSP-001",
  invoiceNumber: "INV-001",
  invoiceHash: claim.invoiceHash,
  billAmount: "0.1",
  treatmentType: "HOSPITALIZATION",
  admissionDate: new Date("2026-08-10T00:00:00Z"),
  dischargeDate: new Date("2026-08-11T00:00:00Z"),
  invoiceStatus: "VALID",
  recordStatus: "VALID",
  licenseStatus: "ACTIVE",
};

test("creates a deterministic positive hospital attestation from matching source data", () => {
  const first = buildHospitalVerificationAssessment({ claim, claimVersion: 1, hospital, record });
  const second = buildHospitalVerificationAssessment({ claim, claimVersion: 1, hospital, record });
  assert.equal(first.outcome, "VERIFIED");
  assert.equal(first.verified, true);
  assert.match(first.attestationHash, /^0x[a-f0-9]{64}$/);
  assert.equal(first.attestationHash, second.attestationHash);
});

test("reports missing and mismatched hospital evidence without fabricating a match", () => {
  const missing = buildHospitalVerificationAssessment({ claim, claimVersion: 1, hospital, record: null });
  const mismatched = buildHospitalVerificationAssessment({
    claim,
    claimVersion: 1,
    hospital,
    record: { ...record, billAmount: "0.2" },
  });
  assert.equal(missing.outcome, "NOT_FOUND");
  assert.equal(missing.verified, false);
  assert.equal(mismatched.outcome, "MISMATCHED");
  assert.equal(mismatched.checks.amountMatches, false);
});

test("invoice possession alone does not establish patient ownership", () => {
  const result = buildHospitalVerificationAssessment({ claim, claimVersion: 1, hospital, record: { ...record, authorizedClaimants: [] } });
  assert.equal(result.verified, false);
  assert.equal(result.checks.patientMatches, false);
});
