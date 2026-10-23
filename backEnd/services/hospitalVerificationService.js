const { ethers } = require("ethers");

const asIso = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const normalizeText = (value) => String(value || "").trim().toUpperCase();

const buildHospitalVerificationAssessment = ({
  claim,
  claimVersion,
  hospital,
  record,
}) => {
  const incidentDate = new Date(Number(claim.incidentDate) * 1000);
  const admissionDate = record ? new Date(record.admissionDate) : null;
  const dischargeDate = record ? new Date(record.dischargeDate) : null;
  if (dischargeDate) dischargeDate.setUTCHours(23, 59, 59, 999);

  let amountMatches = false;
  if (record) {
    try {
      amountMatches = ethers.parseEther(String(record.billAmount)) === claim.claimAmount;
    } catch {
      amountMatches = false;
    }
  }

  const checks = {
    patientMatches: Boolean(record?.authorizedClaimants?.some((wallet) => wallet.toLowerCase() === claim.claimantWallet.toLowerCase())),
    invoiceFound: Boolean(record),
    invoiceHashMatches: Boolean(
      record &&
        String(record.invoiceHash).toLowerCase() ===
          String(claim.invoiceHash).toLowerCase()
    ),
    amountMatches,
    incidentWithinCareDates: Boolean(
      record &&
        !Number.isNaN(incidentDate.getTime()) &&
        incidentDate >= admissionDate &&
        incidentDate <= dischargeDate
    ),
    treatmentMatches: Boolean(
      record &&
        normalizeText(record.treatmentType) === normalizeText(claim.claimType)
    ),
    recordEligible: Boolean(
      record &&
        record.recordStatus === "VALID" &&
        record.invoiceStatus === "VALID" &&
        record.licenseStatus === "ACTIVE"
    ),
  };
  const verified = Object.values(checks).every(Boolean);
  const outcome = verified ? "VERIFIED" : record ? "MISMATCHED" : "NOT_FOUND";
  const claimSnapshot = {
    claimId: claim.claimId.toString(),
    claimVersion: Number(claimVersion),
    claimantWallet: claim.claimantWallet.toLowerCase(),
    hospitalId: claim.hospitalId,
    invoiceHash: claim.invoiceHash.toLowerCase(),
    claimAmountWei: claim.claimAmount.toString(),
    incidentDate: claim.incidentDate.toString(),
    claimType: claim.claimType,
  };
  const recordSnapshot = record
    ? {
        recordId: record._id?.toString?.() || "",
        hospitalId: record.hospitalId,
        invoiceNumber: record.invoiceNumber,
        invoiceHash: record.invoiceHash.toLowerCase(),
        billAmount: record.billAmount,
        treatmentType: record.treatmentType,
        admissionDate: asIso(record.admissionDate),
        dischargeDate: asIso(record.dischargeDate),
        invoiceStatus: record.invoiceStatus,
        recordStatus: record.recordStatus,
        licenseStatus: record.licenseStatus,
      }
    : null;
  const attestationPayload = {
    schema: "BLOCK_INSURE_HOSPITAL_ATTESTATION_V1",
    hospitalId: hospital.hospitalId,
    hospitalWallet: hospital.walletAddress.toLowerCase(),
    outcome,
    verified,
    checks,
    claim: claimSnapshot,
    record: recordSnapshot,
  };

  return {
    outcome,
    verified,
    checks,
    claimSnapshot,
    recordSnapshot,
    attestationHash: ethers.keccak256(
      ethers.toUtf8Bytes(JSON.stringify(attestationPayload))
    ),
  };
};

const formatHospitalVerification = (verification) => {
  if (!verification) return null;
  return {
    id: verification._id,
    claimId: verification.claimId,
    claimVersion: verification.claimVersion,
    hospitalId: verification.hospitalId,
    hospitalWallet: verification.hospitalWallet,
    recordId: verification.recordId,
    invoiceHash: verification.invoiceHash,
    outcome: verification.outcome,
    verified: verification.verified,
    checks: verification.checks,
    attestationHash: verification.attestationHash,
    transactionHash: verification.transactionHash,
    blockNumber: verification.blockNumber,
    note: verification.note,
    verifiedAt: verification.verifiedAt,
    createdAt: verification.createdAt,
  };
};

module.exports = {
  buildHospitalVerificationAssessment,
  formatHospitalVerification,
};
