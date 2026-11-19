import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import CopyableText from "./CopyableText";
import {
  downloadDecryptedEvidence,
  hasLocalEvidenceKey,
} from "../services/evidenceEncryption";

const DEFAULT_GATEWAY =
  import.meta.env.VITE_IPFS_GATEWAY || "https://gateway.pinata.cloud/ipfs/";
const PdfEvidencePreview = lazy(() => import("./PdfEvidencePreview"));

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
  const previewTrigger = useRef(null);
  useEffect(() => {
    if (!preview) return;
    dialog.current?.showModal();
    return () => URL.revokeObjectURL(preview.url);
  }, [preview]);

  if (!cid) {
    return <span>-</span>;
  }

  return (
    <span className="ipfs-link inline-flex flex-wrap items-center gap-2">
      <CopyableText value={cid} label="Copy CID" short />
      <a href={buildIpfsUrl(cid)} target="_blank" rel="noreferrer" download>
        Download encrypted file
      </a>
      {documentId && (hasLocalEvidenceKey(cid) || recoverable) ? (
        <>
          <button
            ref={previewTrigger}
            type="button"
            className="button-secondary"
            disabled={previewPending}
            onClick={async () => {
              setPreviewPending(true);
              setDecryptError("");
              try {
                const blob = await downloadDecryptedEvidence(cid, DEFAULT_GATEWAY, documentId, sha256Hash, true);
                if (!["application/pdf", "image/png", "image/jpeg"].includes(blob.type)) {
                  throw new Error("Preview supports PDF, PNG and JPEG. Use the decrypted download for other files.");
                }
                setPreview({ url: URL.createObjectURL(blob), type: blob.type, blob });
              } catch (error) {
                setDecryptError(error.response?.data?.message || error.message || "Preview unavailable");
              } finally {
                setPreviewPending(false);
              }
            }}
          >
            {previewPending ? "Opening evidence…" : "Preview decrypted"}
          </button>
          <button
            type="button"
            className="button-secondary"
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
      {decryptError ? <span className="error-text" role="alert">{decryptError}</span> : null}
      {preview && createPortal(
        <dialog
          ref={dialog}
          aria-label="Decrypted evidence preview"
          onClose={() => {
            setPreview(null);
            previewTrigger.current?.focus();
          }}
          className="w-[92vw] max-w-4xl max-h-[90dvh] overflow-auto rounded-xl border border-[var(--line-strong)] bg-[var(--surface-strong)] text-[var(--text)] p-5 shadow-[var(--shadow-xl)] backdrop:bg-black/65"
        >
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4 pb-3 border-b border-[var(--line)]">
            <div>
              <h2 className="m-0 text-xl font-bold text-[var(--text)]">Decrypted evidence preview</h2>
              <p className="m-0 mt-1 text-sm text-[var(--muted)]">
                Visible only in this browser after the existing access and integrity checks.
              </p>
            </div>
            <button type="button" className="button-secondary min-h-11" onClick={() => dialog.current?.close()}>
              Close preview
            </button>
          </div>
          {preview && (preview.type === "application/pdf"
            ? <Suspense fallback={<p role="status">Loading PDF preview…</p>}><PdfEvidencePreview blob={preview.blob} /></Suspense>
            : <img alt="Decrypted claim evidence" src={preview.url} className="max-h-[65vh] max-w-full object-contain mx-auto rounded-lg" />)}
        </dialog>,
        document.body
      )}
    </span>
  );
}
