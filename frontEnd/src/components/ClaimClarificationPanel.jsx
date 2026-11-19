import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Contract } from "ethers";
import { api, uploadClaimDocument } from "../services/api";
import { getWalletContract } from "../services/contractService";
import { encryptEvidenceFile, storeEvidenceKey } from "../services/evidenceEncryption";

const signerAbi = ["function applyClarification(uint256,uint64,uint64,uint256,bytes32,bytes)"];

export default function ClaimClarificationPanel({ claim, officer = false, onWaiting, onConfirmed }) {
  const [question, setQuestion] = useState("");
  const [file, setFile] = useState(null);
  const path = `/api/claims/${claim.claimId}/clarification`;
  const request = useQuery({
    queryKey: ["claimClarification", claim.claimId, officer],
    queryFn: async () => (await api.get(path)).data,
    refetchInterval: query => query.state.data?.confirmed ? false : 15_000,
    retry: false,
  });
  const details = request.data;
  const waiting = Boolean(details?.question && (details.canAnswer || details.canReconcile));
  useEffect(() => { onWaiting?.(waiting); }, [onWaiting, waiting]);
  const action = useMutation({
    mutationFn: async mode => {
      if (mode === "open") {
        await api.post(path + "/open", { question });
        return;
      }
      if (mode === "answer") {
        const manager = await getWalletContract();
        if (!details.uploaded) {
          const evidenceType = "CLARIFICATION_DOCUMENT";
          const item = await encryptEvidenceFile(file, { claimId: claim.claimId, claimVersion: details.priorVersion + 1,
            uploader: claim.claimantWallet, evidenceType });
          const { document } = await uploadClaimDocument({ file: item.encryptedFile, documentType: evidenceType,
            claimId: claim.claimId, encryption: { enabled: true, algorithm: item.algorithm,
              originalMimeType: item.originalMimeType, originalName: item.originalName, keyCapsule: item.keyCapsule,
              associatedData: item.associatedData, encryptionIdentityVersion: item.encryptionIdentityVersion } });
          storeEvidenceKey(document.ipfsCID, item);
        }
        const { data } = await api.post(path + "/authorize");
        const panel = new Contract(data.panel, signerAbi, manager.runner);
        await (await panel.applyClarification(...data.args)).wait();
      }
      await api.post(path + "/reconcile");
      await onConfirmed?.();
    },
    onSettled: () => request.refetch(),
  });

  if (!details?.question && !(officer && details?.available)) return null;
  return (
    <section className="card min-w-0">
      <h3>Evidence clarification</h3>
      {details.question && (
        <div className="grid gap-1 mb-3">
          <p className="m-0 text-[var(--text)] font-medium">{details.question}</p>
          <p className="m-0 text-xs muted-text">
            Response deadline {new Date(details.deadline * 1000).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" })} Bangladesh time.
          </p>
        </div>
      )}
      {officer && details.available && (
        <form className="form-grid" onSubmit={event => { event.preventDefault(); action.mutate("open"); }}>
          <label>
            Question for the claimant
            <textarea required maxLength={500} rows={3} value={question} onChange={event => setQuestion(event.target.value)} />
          </label>
          <button type="submit" disabled={action.isPending || !question.trim()}>
            {action.isPending ? "Sending..." : "Request clarification"}
          </button>
        </form>
      )}
      {!officer && details.canAnswer && (
        <form className="form-grid" onSubmit={event => { event.preventDefault(); action.mutate("answer"); }}>
          {details.uploaded ? <p role="status">Your encrypted attachment is ready. Submitting will open your wallet to confirm on-chain clarification.</p> : (
            <label>
              Supporting document
              <input required type="file" accept="application/pdf,image/jpeg,image/png" onChange={event => setFile(event.target.files[0])} />
            </label>
          )}
          <button type="submit" disabled={action.isPending || (!details.uploaded && !file)}>
            {action.isPending ? "Submitting..." : "Submit clarification"}
          </button>
        </form>
      )}
      {details.canReconcile && (
        <div className="action-row">
          <button type="button" disabled={action.isPending} onClick={() => action.mutate("reconcile")}>
            {action.isPending ? "Registering..." : "Register confirmed clarification"}
          </button>
        </div>
      )}
      {details.confirmed && <p role="status" className="success-text">The updated evidence is ready for fresh Oracle verification.</p>}
      {action.isError && <p role="alert" className="error-text">{action.error.response?.data?.message || action.error.shortMessage || action.error.message}</p>}
    </section>
  );
}
