import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPendingAppealAttempts, reconcileAppealAttempt } from "../services/api";
import { sendPreparedAppeal } from "../services/appealSubmission";
import { getReadOnlyContract } from "../services/contractService";
import TransactionLink from "./TransactionLink";
export default function AppealRecoveryPanel({ claimId, onCompleted, revision }) {
  const [error, setError] = useState("");
  const [acting, setActing] = useState(false);
  const query = useQuery({ queryKey: ["appealAttempts", claimId, revision], queryFn: () => getPendingAppealAttempts(claimId), refetchInterval: 5000 });
  const attempts = query.data?.attempts || [];
  if (!attempts.length) return null;
  async function recover(attempt, send = false) {
    setActing(true); setError("");
    try {
      let result = await reconcileAppealAttempt(attempt.id);
      if ((result.pending || result.retryable) && send) {
        if (Number((await getReadOnlyContract().getClaim(claimId)).status) !== 8) throw new Error("The claim already left the rejected state. Recover its existing transaction.");
        if (!window.confirm("Check your wallet first: it must show no pending appeal transaction. Submit the exact saved appeal now?")) return;
        result = await sendPreparedAppeal(result.attempt || attempt);
      }
      if (result.retryable) setError(result.message);
      else if (result.pending) setError("Waiting for the existing wallet transaction. No new appeal round was requested.");
      else await onCompleted?.();
      await query.refetch();
    } catch (failure) { setError(failure.response?.data?.message || failure.shortMessage || failure.message); }
    finally { setActing(false); }
  }
  return <section className="card min-w-0 break-words" aria-label="Appeal recovery"><h3>Unfinished appeal</h3>
    <p>Recover the saved operation before opening another appeal. A confirmed appeal only needs its missing registration completed.</p>
    {attempts.map((attempt) => <article key={attempt.id}><p>Claim version {attempt.claimVersion}: {attempt.status}</p>
      {attempt.lastRevertedTransactionHash && <p>Last confirmed reverted transaction: <TransactionLink txHash={attempt.lastRevertedTransactionHash} /></p>}
      {attempt.status === "DRAFT" ? <p>The draft is saved. Complete the appeal form to finish its corrections and evidence.</p> : <button type="button" disabled={acting} onClick={() => recover(attempt)}>Recover appeal registration</button>}
      {attempt.status === "READY" && !attempt.transactionHash && <button type="button" disabled={acting} onClick={() => recover(attempt, true)}>Submit saved appeal</button>}
    </article>)}{error && <p role="alert">{error}</p>}
  </section>;
}
