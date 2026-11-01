import { recordAppealTransaction, reconcileAppealAttempt } from "./api";
import { getWalletContract, toBytes32FromBackendSha256 } from "./contractService";
export async function sendPreparedAppeal(attempt) {
  const contract = await getWalletContract();
  const payload = attempt.payload;
  const transaction = payload.additionalDocumentHash
    ? await contract.submitAppealWithEvidence(attempt.claimId, attempt.appealReasonHash, toBytes32FromBackendSha256(payload.additionalDocumentHash), payload.additionalDocumentCID)
    : await contract.submitAppeal(attempt.claimId, attempt.appealReasonHash);
  // The sealed server payload already exists if the page disappears before the
  // wallet returns this hash. Recovery can match its committed on-chain event.
  await recordAppealTransaction(attempt.id, transaction.hash);
  await transaction.wait();
  return reconcileAppealAttempt(attempt.id);
}
