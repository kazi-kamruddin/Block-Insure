import { api, getClaimSubmissionAttempt, sealClaimSubmissionAttempt, recordClaimSubmissionTransaction, reconcileClaimSubmission } from "./api";
import { getWalletContract, toBytes32FromBackendSha256 } from "./contractService";
const pendingKey = "block-insure:pending-claim-submissions";
export function rememberClaimAttempt(attemptId, transactionHash = "") {
  const previous = JSON.parse(localStorage.getItem(pendingKey) || "[]");
  const storedHash = previous.find((item) => item.attemptId === attemptId)?.transactionHash || "";
  localStorage.setItem(pendingKey, JSON.stringify([...previous.filter((item) => item.attemptId !== attemptId), { attemptId, transactionHash: transactionHash || storedHash }]));
}
function forgetClaimAttempt(attemptId) {
  localStorage.setItem(pendingKey, JSON.stringify(JSON.parse(localStorage.getItem(pendingKey) || "[]").filter((item) => item.attemptId !== attemptId)));
}
export async function finishClaimAttempt(attemptId) {
  const current = await getClaimSubmissionAttempt(attemptId);
  if (current.attempt.sealedAt || current.attempt.transactionHash) {
    const result = await reconcileClaimSubmission(attemptId);
    if (result.pending) throw new Error("Wallet outcome is unresolved. Use Recover submitted claim and check the original wallet request; do not send another transaction.");
    forgetClaimAttempt(attemptId); return result;
  }
  await sealClaimSubmissionAttempt(attemptId);
  rememberClaimAttempt(attemptId);
  const primary = current.files.find((file) => file.uploadSlot === 0);
  const facts = current.attempt.submittedFacts;
  let transaction;
  try {
    const manager = await getWalletContract();
    transaction = await manager.submitClaim(BigInt(current.attempt.policyId), BigInt(facts.claimAmountWei), BigInt(facts.incidentDate), facts.claimType,
      facts.hospitalId, facts.invoiceHash, toBytes32FromBackendSha256(primary.sha256Hash), primary.ipfsCID);
  } catch (error) {
    if (error.code === 4001 || error.code === "ACTION_REJECTED") {
      await api.patch(`/api/claims/submission-attempts/${attemptId}/preparation`, { action: "WALLET_REJECTED" });
      forgetClaimAttempt(attemptId);
    }
    throw error;
  }
  rememberClaimAttempt(attemptId, transaction.hash);
  await recordClaimSubmissionTransaction(attemptId, transaction.hash);
  await transaction.wait();
  const result = await reconcileClaimSubmission(attemptId);
  if (!result.pending) forgetClaimAttempt(attemptId);
  return result;
}
