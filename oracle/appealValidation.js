// Versioned transaction-proof compatibility. The historical validator below
// remains byte-identical inside this factory; v5 changes transport proof only.
function createAppealValidators({ crypto, ethers, provider, manager, CONTRACT_ADDRESS, invoiceIdentity, normalizeHash }) {
const validateAppealCommitment = async (request, claim, response) => {
  if (Number(request.claimVersion) <= 1) return true;
  const commitment = response.appealCommitment;
  const payload = commitment?.payload;
  if (!payload || payload.schema !== "BLOCK_INSURE_APPEAL_V1") return false;

  const computedHash = `0x${crypto
    .createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex")}`;
  if (normalizeHash(computedHash) !== normalizeHash(commitment.appealReasonHash)) {
    return false;
  }

  const query = response.query || {};
  const invoiceCandidates = payload.proposedInvoiceNumber
    ? [ethers.id(payload.proposedInvoiceNumber.trim()), invoiceIdentity(claim.hospitalId, payload.proposedInvoiceNumber)]
    : [claim.invoiceHash];
  const expectedInvoiceHash = claim.invoiceHash;
  const expectedAmount = payload.proposedClaimAmountEth || ethers.formatEther(claim.claimAmount);
  if (ethers.parseEther(expectedAmount) !== claim.claimAmount ||
      !invoiceCandidates.some((hash) => normalizeHash(hash) === normalizeHash(claim.invoiceHash)) ||
      (payload.proposedHospitalId && payload.proposedHospitalId !== claim.hospitalId) ||
      (payload.proposedClaimType && payload.proposedClaimType !== claim.claimType)) return false;
  if (
    String(payload.claimId) !== claim.claimId.toString() ||
    String(query.claimId) !== claim.claimId.toString() ||
    normalizeHash(query.invoiceHash) !== normalizeHash(expectedInvoiceHash) ||
    String(query.hospitalId) !== String(payload.proposedHospitalId || claim.hospitalId) ||
    String(query.claimType) !== String(payload.proposedClaimType || claim.claimType) ||
    String(query.claimAmountEth) !== String(expectedAmount)
  ) {
    return false;
  }

  const [receipt, transaction] = await Promise.all([
    provider.getTransactionReceipt(commitment.transactionHash),
    provider.getTransaction(commitment.transactionHash),
  ]);
  if (
    !receipt ||
    !transaction ||
    Number(receipt.status) !== 1 ||
    normalizeHash(transaction.to) !== normalizeHash(CONTRACT_ADDRESS) ||
    normalizeHash(transaction.from) !== normalizeHash(claim.claimantWallet)
  ) {
    return false;
  }
  return receipt.logs.some((log) => {
    try {
      const event = manager.interface.parseLog(log);
      return (
        normalizeHash(log.address) === normalizeHash(CONTRACT_ADDRESS) && event?.name === "ClaimAppealed" &&
        event.args.claimId.toString() === claim.claimId.toString() &&
        normalizeHash(event.args.appealReasonHash) === normalizeHash(computedHash)
      );
    } catch {
      return false;
    }
  });
};

const validateAppealCommitmentV5 = async (request, claim, response) => {
  if (Number(request.claimVersion) <= 1) return true;
  const commitment = response.appealCommitment;
  const payload = commitment?.payload;
  if (!payload || payload.schema !== "BLOCK_INSURE_APPEAL_V1") return false;

  const computedHash = `0x${crypto
    .createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex")}`;
  if (normalizeHash(computedHash) !== normalizeHash(commitment.appealReasonHash)) {
    return false;
  }

  const query = response.query || {};
  const invoiceCandidates = payload.proposedInvoiceNumber
    ? [ethers.id(payload.proposedInvoiceNumber.trim()), invoiceIdentity(claim.hospitalId, payload.proposedInvoiceNumber)]
    : [claim.invoiceHash];
  const expectedInvoiceHash = claim.invoiceHash;
  const expectedAmount = payload.proposedClaimAmountEth || ethers.formatEther(claim.claimAmount);
  if (ethers.parseEther(expectedAmount) !== claim.claimAmount ||
      !invoiceCandidates.some((hash) => normalizeHash(hash) === normalizeHash(claim.invoiceHash)) ||
      (payload.proposedHospitalId && payload.proposedHospitalId !== claim.hospitalId) ||
      (payload.proposedClaimType && payload.proposedClaimType !== claim.claimType)) return false;
  if (
    String(payload.claimId) !== claim.claimId.toString() ||
    String(query.claimId) !== claim.claimId.toString() ||
    normalizeHash(query.invoiceHash) !== normalizeHash(expectedInvoiceHash) ||
    String(query.hospitalId) !== String(payload.proposedHospitalId || claim.hospitalId) ||
    String(query.claimType) !== String(payload.proposedClaimType || claim.claimType) ||
    String(query.claimAmountEth) !== String(expectedAmount)
  ) {
    return false;
  }

  if (!/^0x[\da-f]{64}$/i.test(commitment.transactionHash || "")) return false;
  const receipt = await provider.getTransactionReceipt(commitment.transactionHash);
  if (!receipt || Number(receipt.status) !== 1 || !Number.isSafeInteger(receipt.blockNumber) ||
      !Number.isSafeInteger(Number(request.requestBlock)) || receipt.blockNumber > Number(request.requestBlock)) return false;
  const matches = (iface, address, name, accept) => (receipt.logs || []).filter(log => {
    if (normalizeHash(log.address) !== normalizeHash(address)) return false;
    try { const event = iface.parseLog(log); return event?.name === name && accept(event.args); }
    catch { return false; }
  });
  const appeals = matches(manager.interface, CONTRACT_ADDRESS, "ClaimAppealed", args =>
    String(args.claimId) === String(claim.claimId) && normalizeHash(args.claimant) === normalizeHash(claim.claimantWallet) &&
    normalizeHash(args.appealReasonHash) === normalizeHash(computedHash));
  if (appeals.length !== 1) return false;
  const adjudicatorAddress = await manager.claimAdjudicator();
  if (!ethers.isAddress(adjudicatorAddress) || adjudicatorAddress === ethers.ZeroAddress) return false;
  const adjudicator = new ethers.Interface(["event AppealStarted(uint256 indexed claimId,uint8 appealRound,uint64 newClaimVersion)"]);
  const versions = matches(adjudicator, adjudicatorAddress, "AppealStarted", args =>
    String(args.claimId) === String(claim.claimId) && String(args.newClaimVersion) === String(request.claimVersion));
  // Round zero is valid for the existing one-time access-preparation retry.
  return versions.length === 1;
};

  return { legacy: validateAppealCommitment, eventBound: validateAppealCommitmentV5 };
}
module.exports = { createAppealValidators };
