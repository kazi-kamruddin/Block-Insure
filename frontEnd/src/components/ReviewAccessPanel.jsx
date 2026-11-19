import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getReviewAccess, authorizeReviewAccess, resumeReviewAccess } from "../services/api";
import { buildReviewDelegations } from "../services/evidenceEncryption";
import { getReadOnlyClaimAdjudicator } from "../services/contractService";
import { useWallet } from "../context/useWallet";
import CopyableText from "./CopyableText";
import { formatDateTime } from "../utils/dateFormat";

export default function ReviewAccessPanel({ claimId, onChange }) {
  const { walletAddress } = useWallet();
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["reviewAccess", claimId, walletAddress],
    queryFn: () => getReviewAccess(claimId),
    refetchInterval: acting ? false : 10_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const preparation = query.data?.preparation;
  if (query.isLoading) return <p role="status">Checking evidence access preparation…</p>;
  if (query.error) {
    return (
      <section className="card">
        <h3>Evidence access</h3>
        <p role="alert">{query.error.response?.data?.message || "Evidence preparation is unavailable."}</p>
        <div className="action-row">
          <button type="button" className="button-secondary" onClick={() => query.refetch()}>
            Retry access status
          </button>
        </div>
      </section>
    );
  }
  if (!preparation || preparation.state === "NOT_ASSIGNED") return null;

  async function authorize() {
    setActing(true);
    setError("");
    try {
      if (preparation.batchExists) await resumeReviewAccess(claimId);
      else await authorizeReviewAccess(claimId, await buildReviewDelegations(preparation, walletAddress));
      await query.refetch();
      await onChange?.();
    } catch (failure) {
      setError(failure.response?.data?.message || failure.message);
    } finally {
      setActing(false);
    }
  }

  async function expire() {
    setActing(true);
    setError("");
    try {
      const { getSigner } = await import("../services/contractService");
      const adjudicator = (await getReadOnlyClaimAdjudicator()).connect(await getSigner());
      await (await adjudicator.expirePreparation(claimId, preparation.claimVersion)).wait();
      await query.refetch();
      await onChange?.();
    } catch (failure) {
      setError(failure.response?.data?.message || failure.shortMessage || failure.message);
    } finally {
      setActing(false);
    }
  }

  return (
    <section className="card min-w-0 break-words" aria-label="Evidence access preparation">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h3 className="m-0">Evidence access preparation</h3>
        <span className="dashboard-context-pill" role="status">
          {preparation.state.replaceAll("_", " ")} · {preparation.grantedCount}/{preparation.requiredCount} prepared
        </span>
      </div>
      <p>
        Four assigned reviewers receive access to the fixed evidence set. Voting starts after technical access preparation. Stored grants support later viewing while the claimant is offline.
      </p>
      {(preparation.preparationDeadline > 0 || preparation.votingDeadline > 0) && (
        <dl className="detail-kv-grid">
          {preparation.preparationDeadline > 0 && (
            <div>
              <dt>Preparation deadline</dt>
              <dd>{formatDateTime(preparation.preparationDeadline)}</dd>
            </div>
          )}
          {preparation.votingDeadline > 0 && (
            <div>
              <dt>Voting deadline</dt>
              <dd>{formatDateTime(preparation.votingDeadline)}</dd>
            </div>
          )}
        </dl>
      )}
      <div className="grid gap-2 my-3">
        {preparation.recipients.map((recipient) => (
          <div
            key={recipient.walletAddress}
            className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg border border-[var(--line)] bg-[var(--surface-soft)] text-sm"
          >
            <CopyableText value={recipient.walletAddress} label="Copy auditor" short />
            <span className={recipient.keyReady ? "success-text" : "muted-text"}>
              {recipient.keyReady
                ? `Encryption identity ready (v${recipient.keyVersion})`
                : "Register or restore encryption identity in My profile"}
            </span>
          </div>
        ))}
      </div>
      <div className="action-row">
        {preparation.owner && !["FINALIZED", "PREPARATION_EXPIRED"].includes(preparation.state) && (
          <button
            type="button"
            disabled={acting || !preparation.evidenceSetHash || preparation.recipients.some((recipient) => !recipient.keyReady)}
            onClick={authorize}
          >
            {acting
              ? "Preparing access…"
              : preparation.batchExists
                ? "Resume stored reviewer authorization"
                : "Authorize assigned reviewers"}
          </button>
        )}
        {preparation.state === "PREPARATION_EXPIRED" && (
          <button type="button" disabled={acting} onClick={expire}>
            Close incomplete preparation
          </button>
        )}
      </div>
      {preparation.state === "PREPARATION_EXPIRED" && (
        <p>
          Access preparation was not completed. Closing releases the claim reservation with an incomplete-evidence reason, not a fraud verdict. One preparation retry is available under the claim’s remaining eligibility rules.
        </p>
      )}
      {preparation.batchStatus === "STALE" && (
        <p role="alert" className="error-text">
          A grant or registered key changed. A lost browser key can be restored to the existing identity; revoked grants need explicit owner reauthorization. A registered key-version change cannot reuse this pinned authorization. Remaining reviewers may act, or the bounded expiry/recovery path applies. Voting time and panel do not reset.
        </p>
      )}
      {error && <p role="alert" className="error-text">{error}</p>}
      <p className="muted-text">
        The insurer attests technical grant availability. This does not prove reading, medical truth or claim approval. Revocation cannot erase downloaded copies.
      </p>
    </section>
  );
}
