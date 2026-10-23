const crypto = require("crypto");

const normalizeHash = (value) => String(value || "").trim().toLowerCase();
const stripHexPrefix = (value) => normalizeHash(value).replace(/^0x/, "");

const getCanonicalRecordPayload = (record = {}) => ({
  hospitalId: record.hospitalId,
  hospitalName: record.hospitalName,
  licenseStatus: record.licenseStatus,
  patientHash: record.patientHash,
  ...(record.authorizedClaimants?.length ? { authorizedClaimants: [...record.authorizedClaimants].map((wallet) => wallet.toLowerCase()).sort() } : {}),
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
  datasetProfile: record.datasetProfile,
  baseDataOrigin: record.baseDataOrigin,
  claimSetting: record.claimSetting,
  providerPotentialFraud: record.providerPotentialFraud,
  providerLabelType: record.providerLabelType,
  scenarioInjected: record.scenarioInjected,
  scenarioType: record.scenarioType,
  scenarioVersion: record.scenarioVersion,
  sourceClaimAmountUsd: record.sourceClaimAmountUsd,
  sourceProcedureCode: record.sourceProcedureCode,
  amountNormalizationVersion: record.amountNormalizationVersion,
  amountNormalizationDivisor: record.amountNormalizationDivisor,
  previousClaimCount: record.previousClaimCount,
  providerVelocityAnomaly: record.providerVelocityAnomaly,
  claimantVelocityAnomaly: record.claimantVelocityAnomaly,
  nearDuplicateAdvisory: record.nearDuplicateAdvisory,
  isMissingOrNoisy: record.isMissingOrNoisy,
  dataQuality: record.dataQuality,
  recurringLegitimate: record.recurringLegitimate,
  fraudSignals: {
    usedInvoice: record.fraudSignals?.usedInvoice,
    cancelledRecord: record.fraudSignals?.cancelledRecord,
    inflatedAmount: record.fraudSignals?.inflatedAmount,
    blacklistedHospital: record.fraudSignals?.blacklistedHospital,
    dateMismatch: record.fraudSignals?.dateMismatch,
  },
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
