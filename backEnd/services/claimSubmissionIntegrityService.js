const normalizeClaimType = (value) =>
  String(value || "").trim().toUpperCase();

const claimMatchesSubmittedFacts = (claim, submittedFacts) => {
  if (
    !submittedFacts?.incidentDate ||
    !submittedFacts?.claimAmountWei ||
    !submittedFacts?.claimType
  ) {
    return false;
  }

  return (
    claim.incidentDate.toString() === String(submittedFacts.incidentDate) &&
    claim.claimAmount.toString() === String(submittedFacts.claimAmountWei) &&
    normalizeClaimType(claim.claimType) ===
      normalizeClaimType(submittedFacts.claimType)
  );
};

module.exports = { claimMatchesSubmittedFacts };
