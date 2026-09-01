const normalizeClaimType = (value) =>
  String(value || "").trim().toUpperCase();
const normalizeText = (value) => String(value || "").trim().toLowerCase();

const claimMatchesSubmittedFacts = (claim, submittedFacts) => {
  if (
    !submittedFacts?.incidentDate ||
    !submittedFacts?.claimAmountWei ||
    !submittedFacts?.claimType ||
    !submittedFacts?.hospitalId ||
    !submittedFacts?.invoiceHash
  ) {
    return false;
  }

  return (
    claim.incidentDate.toString() === String(submittedFacts.incidentDate) &&
    claim.claimAmount.toString() === String(submittedFacts.claimAmountWei) &&
    normalizeClaimType(claim.claimType) ===
      normalizeClaimType(submittedFacts.claimType)
    && normalizeClaimType(claim.hospitalId) ===
      normalizeClaimType(submittedFacts.hospitalId)
    && normalizeText(claim.invoiceHash) === normalizeText(submittedFacts.invoiceHash)
  );
};

module.exports = { claimMatchesSubmittedFacts };
