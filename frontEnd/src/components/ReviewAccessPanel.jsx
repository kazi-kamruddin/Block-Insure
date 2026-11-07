import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getReviewAccess, authorizeReviewAccess, resumeReviewAccess } from "../services/api";
import { buildReviewDelegations } from "../services/evidenceEncryption";
import { getReadOnlyClaimAdjudicator } from "../services/contractService";
import { useWallet } from "../context/useWallet";

export default function ReviewAccessPanel({ claimId, onChange }) {
  const { walletAddress } = useWallet();
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");
  const query = useQuery({ queryKey: ["reviewAccess", claimId, walletAddress], queryFn: () => getReviewAccess(claimId), refetchInterval: acting ? false : 10_000, refetchIntervalInBackground: false, retry: false });
  const preparation = query.data?.preparation;
  if (query.isLoading) return <p role="status">Checking evidence access preparation…</p>;
  if (query.error) return <section className="card"><h3>Evidence access</h3><p role="alert">{query.error.response?.data?.message || "Evidence preparation is unavailable."}</p><button type="button" onClick={() => query.refetch()}>Retry access status</button></section>;
  if (!preparation || preparation.state === "NOT_ASSIGNED") return null;
  async function authorize() {
    setActing(true); setError("");
    try {
      if (preparation.batchExists) await resumeReviewAccess(claimId);
      else await authorizeReviewAccess(claimId, await buildReviewDelegations(preparation, walletAddress));
      await query.refetch(); await onChange?.();
    } catch (failure) { setError(failure.response?.data?.message || failure.message); }
    finally { setActing(false); }
  }
  async function expire() {
    setActing(true); setError("");
    try {
      const { getSigner } = await import("../services/contractService");
      const adjudicator = (await getReadOnlyClaimAdjudicator()).connect(await getSigner());
      await (await adjudicator.expirePreparation(claimId, preparation.claimVersion)).wait();
      await query.refetch(); await onChange?.();
    } catch (failure) { setError(failure.response?.data?.message || failure.shortMessage || failure.message); }
    finally { setActing(false); }
  }
  return <section className="card min-w-0 break-words" aria-label="Evidence access preparation">
    <h3>Evidence access preparation</h3>
    <p role="status">{preparation.state.replaceAll("_", " ")} · {preparation.grantedCount}/{preparation.requiredCount} file permissions prepared</p>
    <p>Four assigned reviewers receive access to the fixed evidence set. Voting starts after technical access preparation. Stored grants support later viewing while the claimant is offline.</p>
    {preparation.preparationDeadline > 0 && <p>Preparation deadline: {new Date(preparation.preparationDeadline * 1000).toLocaleString()}</p>}
    {preparation.votingDeadline > 0 && <p>Voting deadline: {new Date(preparation.votingDeadline * 1000).toLocaleString()}</p>}
    <ul>{preparation.recipients.map((recipient) => <li key={recipient.walletAddress} className="break-all">{recipient.walletAddress}: {recipient.keyReady ? `encryption identity ready (v${recipient.keyVersion})` : "register or restore encryption identity in My profile"}</li>)}</ul>
    {preparation.owner && !["FINALIZED", "PREPARATION_EXPIRED"].includes(preparation.state) && <button type="button" disabled={acting || !preparation.evidenceSetHash || preparation.recipients.some((recipient) => !recipient.keyReady)} onClick={authorize}>{acting ? "Preparing access…" : preparation.batchExists ? "Resume stored reviewer authorization" : "Authorize assigned reviewers"}</button>}
    {preparation.state === "PREPARATION_EXPIRED" && <><p>Access preparation was not completed. Closing releases the claim reservation with an incomplete-evidence reason, not a fraud verdict. One preparation retry is available under the claim’s remaining eligibility rules.</p><button type="button" disabled={acting} onClick={expire}>Close incomplete preparation</button></>}
    {preparation.batchStatus === "STALE" && <p role="alert">A grant or registered key changed. A lost browser key can be restored to the existing identity; revoked grants need explicit owner reauthorization. A registered key-version change cannot reuse this pinned authorization. Remaining reviewers may act, or the bounded expiry/recovery path applies. Voting time and panel do not reset.</p>}
    {error && <p role="alert">{error}</p>}
    <p className="muted-text">The insurer attests technical grant availability. This does not prove reading, medical truth or claim approval. Revocation cannot erase downloaded copies.</p>
  </section>;
}
