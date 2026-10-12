const crypto = require("node:crypto");

const normalizedText = (value) => String(value || "").trim();

const buildAppealCommitmentPayload = (source = {}) => ({
  schema: "BLOCK_INSURE_APPEAL_V1",
  claimId: normalizedText(source.claimId),
  appealReason: normalizedText(source.appealReason),
  reasonCategory: normalizedText(source.reasonCategory || "OTHER").toUpperCase(),
  appealDescription: normalizedText(
    source.appealDescription || source.appealReason
  ),
  additionalDocumentHash: normalizedText(source.additionalDocumentHash).toLowerCase(),
  additionalDocumentCID: normalizedText(source.additionalDocumentCID),
  proposedHospitalId: normalizedText(source.proposedHospitalId).toUpperCase(),
  proposedInvoiceNumber: normalizedText(source.proposedInvoiceNumber),
  proposedClaimType: normalizedText(source.proposedClaimType).toUpperCase(),
  proposedClaimAmountEth: normalizedText(source.proposedClaimAmountEth),
});

const hashAppealCommitment = (payload) =>
  `0x${crypto
    .createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex")}`;

module.exports = { buildAppealCommitmentPayload, hashAppealCommitment };
