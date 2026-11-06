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

// A sponsored/smart-account transaction may have a relayer as its outer sender
// and an executor as its outer recipient. Authority comes from the configured
// manager's event plus its stored claim, not those outer transport addresses.
const resolveSubmittedClaim = async ({ contract, receipt, walletAddress, attempt, file }) => {
  const fail = (message, statusCode = 409) => {
    throw Object.assign(new Error(message), { statusCode });
  };
  if (Number(receipt?.status) !== 1) fail("Claim transaction is not successful");
  const manager = normalizeText(await contract.getAddress());
  const matches = new Map();
  for (const log of receipt.logs || []) {
    if (normalizeText(log.address) !== manager) continue;
    let event;
    try { event = contract.interface.parseLog(log); } catch { continue; }
    if (event?.name !== "ClaimSubmitted"
      || normalizeText(event.args.claimantWallet) !== normalizeText(walletAddress)
      || String(event.args.policyId) !== String(attempt.policyId)) continue;
    const claimId = event.args.claimId.toString();
    const claim = await contract.getClaim(claimId);
    if (normalizeText(claim.claimantWallet) !== normalizeText(walletAddress)
      || String(claim.policyId) !== String(attempt.policyId)
      || !claimMatchesSubmittedFacts(claim, attempt.submittedFacts)
      || normalizeText(claim.documentHash) !== normalizeText(`0x${file.sha256Hash}`)
      || claim.documentCID !== file.ipfsCID) continue;
    matches.set(claimId, claim);
  }
  if (!matches.size) fail("Confirmed transaction has no claim matching this wallet, policy, facts and evidence", 403);
  if (matches.size !== 1) fail("Confirmed transaction contains multiple matching claims");
  const [claimId, claim] = matches.entries().next().value;
  return { claimId, claim };
};

module.exports = { claimMatchesSubmittedFacts, resolveSubmittedClaim };
