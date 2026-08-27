const crypto = require("crypto");

const normalizeHash = (value) => String(value || "").trim().toLowerCase();
const stripHexPrefix = (value) => normalizeHash(value).replace(/^0x/, "");

const getCanonicalRecordPayload = (record = {}) => ({
  hospitalId: record.hospitalId,
  hospitalName: record.hospitalName,
  licenseStatus: record.licenseStatus,
  patientHash: record.patientHash,
  treatmentType: record.treatmentType,
  diagnosisCode: record.diagnosisCode,
  admissionDate: record.admissionDate || null,
  dischargeDate: record.dischargeDate || null,
  invoiceDate: record.invoiceDate || null,
  billAmount: record.billAmount,
  expectedBillMin: record.expectedBillMin,
  expectedBillMax: record.expectedBillMax,
  invoiceNumber: record.invoiceNumber,
  invoiceHash: normalizeHash(record.invoiceHash),
  invoiceStatus: record.invoiceStatus,
  recordStatus: record.recordStatus,
  fraudLabel: record.fraudLabel,
});

const hashCanonicalRecord = (record) =>
  `0x${crypto
    .createHash("sha256")
    .update(JSON.stringify(getCanonicalRecordPayload(record)))
    .digest("hex")}`;

const hashPair = (leftHash, rightHash) => {
  const pairInput = `${stripHexPrefix(leftHash)}${stripHexPrefix(rightHash)}`;
  return `0x${crypto.createHash("sha256").update(pairInput).digest("hex")}`;
};

const verifyRegistryProof = (merkleProof) => {
  if (
    !merkleProof?.found ||
    !merkleProof?.leafHash ||
    !merkleProof?.rootHash ||
    !merkleProof?.canonicalRecord ||
    !Array.isArray(merkleProof.proof)
  ) {
    return false;
  }

  const reconstructedLeafHash = hashCanonicalRecord(
    merkleProof.canonicalRecord
  );
  if (normalizeHash(reconstructedLeafHash) !== normalizeHash(merkleProof.leafHash)) {
    return false;
  }

  let computedHash = reconstructedLeafHash;

  for (const step of merkleProof.proof) {
    if (
      !step?.siblingHash ||
      !["left", "right"].includes(step.position)
    ) {
      return false;
    }

    computedHash =
      step.position === "left"
        ? hashPair(step.siblingHash, computedHash)
        : hashPair(computedHash, step.siblingHash);
  }

  return normalizeHash(computedHash) === normalizeHash(merkleProof.rootHash);
};

module.exports = {
  hashPair,
  getCanonicalRecordPayload,
  hashCanonicalRecord,
  verifyRegistryProof,
};
