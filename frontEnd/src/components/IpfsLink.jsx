import { useEffect, useRef, useState } from "react";

import CopyableText from "./CopyableText";
import {
  downloadDecryptedEvidence,
  hasLocalEvidenceKey,
} from "../services/evidenceEncryption";

const DEFAULT_GATEWAY =
  import.meta.env.VITE_IPFS_GATEWAY || "https://gateway.pinata.cloud/ipfs/";

function buildIpfsUrl(cid) {
  if (!cid) return "#";

  const cleanCid = String(cid).replace("ipfs://", "");
  const gateway = DEFAULT_GATEWAY.endsWith("/")
    ? DEFAULT_GATEWAY
    : `${DEFAULT_GATEWAY}/`;

  return `${gateway}${cleanCid}`;
}

export default function IpfsLink({
  cid,
  documentId,
  recoverable = false,
  sha256Hash = "",
}) {
  const [decryptError, setDecryptError] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewPending, setPreviewPending] = useState(false);
  const dialog = useRef(null);
  useEffect(() => {
    if (!preview) return;
    dialog.current?.showModal();
    return () => URL.revokeObjectURL(preview.url);
  }, [preview]);

  if (!cid) {
    return <span>-</span>;
  }

  return (
    <span className="ipfs-link">
      <CopyableText value={cid} label="Copy CID" short />
      {" "}
      <a href={buildIpfsUrl(cid)} target="_blank" rel="noreferrer" download>
        Download encrypted file
      </a>
      {hasLocalEvidenceKey(cid) || (recoverable && documentId) ? (
        <>
          <button type="button" disabled={previewPending} onClick={async () => {
            setPreviewPending(true); setDecryptError("");
            try {
              const blob = await downloadDecryptedEvidence(cid, DEFAULT_GATEWAY, documentId, sha256Hash, true);
              if (!["application/pdf", "image/png", "image/jpeg"].includes(blob.type)) throw new Error("Preview supports PDF, PNG and JPEG. Use the decrypted download for other files.");
              setPreview({ url: URL.createObjectURL(blob), type: blob.type });
            } catch (error) { setDecryptError(error.response?.data?.message || error.message || "Preview unavailable"); }
            finally { setPreviewPending(false); }
          }}>{previewPending ? "Opening evidence…" : "Preview decrypted"}</button>
          {" "}
          <button
            type="button"
            onClick={async () => {
              setDecryptError("");

              try {
                await downloadDecryptedEvidence(
                  cid,
                  DEFAULT_GATEWAY,
                  documentId,
                  sha256Hash
                );
              } catch (error) {
                setDecryptError(
                  error.response?.data?.message ||
                    error.message ||
                    "Could not decrypt evidence"
                );
              }
            }}
          >
            Download decrypted
          </button>
        </>
      ) : null}
      {decryptError ? <span className="error-text" role="alert"> {decryptError}</span> : null}
      <dialog ref={dialog} aria-label="Decrypted evidence preview" onClose={() => setPreview(null)} className="w-[90vw] max-w-4xl max-h-[90dvh] overflow-auto rounded-xl bg-[var(--surface)] text-[var(--text)] p-4">
        <h2>Decrypted evidence preview</h2>
        <p>Visible only in this browser after the existing access and integrity checks.</p>
        <button type="button" onClick={() => dialog.current?.close()}>Close preview</button>
        {preview && (preview.type === "application/pdf" ? <iframe title="Evidence PDF" sandbox="" src={preview.url} className="h-[65vh] w-full" /> : <img alt="Decrypted claim evidence" src={preview.url} className="max-h-[65vh] max-w-full object-contain" />)}
      </dialog>
    </span>
  );
}
