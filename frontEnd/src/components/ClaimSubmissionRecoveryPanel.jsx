import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, reconcileClaimSubmission } from "../services/api";
import { finishClaimAttempt } from "../services/claimEvidenceSubmission";

export default function ClaimSubmissionRecoveryPanel({ onResume, onCompleted, revision }) {
  const [error, setError] = useState("");
  const [acting, setActing] = useState("");
  const query = useQuery({ queryKey: ["pendingClaimAttempts", revision], queryFn: async () => (await api.get("/api/claims/submission-attempts")).data, refetchInterval: 5000 });
  const attempts = query.data?.attempts || [];
  if (!attempts.length) return null;
  async function run(attempt, keep = false) {
    setActing(attempt._id); setError("");
    try {
      if (keep) {
        if (!window.confirm("Continue with the uploaded primary invoice and supporting files only? Remaining selected but unuploaded files will be excluded explicitly.")) return;
        await api.patch(`/api/claims/submission-attempts/${attempt._id}/preparation`, { action: "KEEP_UPLOADED" });
      }
      const result = attempt.sealedAt || attempt.transactionHash ? await reconcileClaimSubmission(attempt._id) : await finishClaimAttempt(attempt._id);
      if (result.pending) setError("No matching confirmed claim yet. Keep the existing wallet request and retry recovery; no new transaction was sent.");
      else await onCompleted?.(result);
      await query.refetch();
    } catch (failure) { setError(failure.response?.data?.message || failure.shortMessage || failure.message); }
    finally { setActing(""); }
  }
  return <section className="card min-w-0 break-words" aria-label="Claim submission recovery"><h3>Continue an unfinished claim</h3>
    <p>Uploaded evidence and the original authorization are retained. Recovery completes an existing transaction rather than consuming another claim submission.</p>
    {attempts.map((attempt) => <article key={attempt._id} className="my-3 border-t border-[var(--border)] pt-3"><p>Policy #{attempt.policyId} · {attempt.status} · {attempt.documentIds.length}/{attempt.expectedEvidenceCount} selected files uploaded</p>
      {!attempt.sealedAt && !attempt.transactionHash && <button type="button" disabled={Boolean(acting)} onClick={() => onResume(attempt)}>Resume evidence uploads</button>}
      {!attempt.sealedAt && !attempt.transactionHash && ["AUTHORIZED", "UPLOADED"].includes(attempt.status) && <button type="button" disabled={Boolean(acting)} onClick={async () => {
        if (!window.confirm("Abandon this unsubmitted attempt and remove its unused encrypted uploads?")) return;
        setActing(attempt._id); setError("");
        try { await api.delete(`/api/claims/submission-attempts/${attempt._id}`, { data: { reason: "Owner abandoned an unsubmitted evidence preparation" } }); await query.refetch(); }
        catch (failure) { setError(failure.response?.data?.message || failure.message); }
        finally { setActing(""); }
      }}>Abandon unsubmitted attempt</button>}
      {attempt.status === "UPLOADED" && !attempt.sealedAt && <button type="button" disabled={Boolean(acting)} onClick={() => run(attempt)}>Submit prepared claim</button>}
      {!attempt.sealedAt && attempt.status === "AUTHORIZED" && attempt.documentIds.length > 0 && <button type="button" disabled={Boolean(acting)} onClick={() => run(attempt, true)}>Continue with uploaded files only</button>}
      {(attempt.sealedAt || attempt.transactionHash) && <button type="button" disabled={Boolean(acting)} onClick={() => run(attempt)}>Recover submitted claim</button>}
    </article>)}{error && <p role="alert">{error}</p>}
  </section>;
}
