import { useState } from "react";
import CopyableText from "./CopyableText";
import IpfsLink from "./IpfsLink";
import { getEvidenceReceipt } from "../services/api";

function formatValue(value) {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

export default function EvidenceChainPanel({
  evidenceChain,
  assignedAuditors = [],
  onGrantAccess,
  onRevokeAccess,
  delegationPending = "",
}) {
  const documents = evidenceChain?.documents || [];
  const [receiptError, setReceiptError] = useState("");

  async function downloadReceipt(documentId) {
    try {
      setReceiptError("");
      const response = await getEvidenceReceipt(documentId);
      const blob = new Blob([JSON.stringify(response.receipt, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `block-insure-evidence-${documentId}-receipt.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setReceiptError(
        error.response?.data?.message || error.message || "Receipt unavailable"
      );
    }
  }

  if (!evidenceChain) {
    return null;
  }

  return (
    <div className="evidence-chain-panel">
      <div className="evidence-chain-header">
        <div>
          <h3>Evidence Hash Chain</h3>
          <p>
            {formatValue(evidenceChain.documentCount)} linked document
            {evidenceChain.documentCount === 1 ? "" : "s"}
          </p>
          <p>
            Integrity check only: this proves the stored files and their order
            have not changed. It does not prove that the medical content is true.
          </p>
        </div>
        <span
          className={`evidence-chain-status ${
            evidenceChain.verified ? "is-verified" : "is-broken"
          }`}
        >
          {evidenceChain.verified ? "Verified" : "Broken"}
        </span>
      </div>

      {evidenceChain.headHash ? (
        <p className="evidence-chain-head">
          <strong>Current head:</strong>{" "}
          <CopyableText value={evidenceChain.headHash} label="Copy head" />
        </p>
      ) : (
        <p className="muted-text">No off-chain evidence documents linked yet.</p>
      )}

      {documents.length > 0 ? (
        <div className="evidence-chain-list">
          {receiptError ? <p className="error-text">{receiptError}</p> : null}
          {documents.map((document) => (
            <article
              className={`evidence-chain-item ${
                document.chainLinkVerified ? "is-verified" : "is-broken"
              }`}
              key={document.id || document.evidenceChainHash}
            >
              <div className="evidence-chain-item-head">
                <strong>
                  {Number(document.evidenceChainIndex) === 0
                    ? "Original claim evidence"
                    : document.documentType === "APPEAL_DOCUMENT"
                      ? "Appeal evidence"
                      : `Additional evidence #${formatValue(document.evidenceChainIndex)}`}
                </strong>
                <span>{document.chainLinkVerified ? "VALID" : "CHECK"}</span>
              </div>

              <p className="evidence-file-name">
                {formatValue(document.originalName)}
              </p>
              <p>Uploaded: {formatDate(document.uploadedAt)}</p>
              <p>
                Encrypted evidence:{" "}
                <IpfsLink
                  cid={document.ipfsCID}
                  documentId={document.id}
                  recoverable={document.recoverableAcrossBrowsers}
                  sha256Hash={document.sha256Hash}
                />
              </p>
              <button type="button" onClick={() => downloadReceipt(document.id)}>
                Download transparency receipt
              </button>
              <details className="technical-details">
                <summary>Integrity and storage details</summary>
                <p>Document type: {formatValue(document.documentType)}</p>
                <p>
                  File SHA-256:{" "}
                  <CopyableText value={document.sha256Hash} label="Copy hash" />
                </p>
                <p>
                  Previous chain hash:{" "}
                  <CopyableText
                    value={document.previousEvidenceHash}
                    label="Copy previous"
                  />
                </p>
                <p>
                  This link’s chain hash:{" "}
                  <CopyableText
                    value={document.evidenceChainHash}
                    label="Copy chain hash"
                  />
                </p>
              </details>
              {assignedAuditors.length > 0 && onGrantAccess ? (
                <details className="technical-details">
                  <summary>Cryptographic auditor access</summary>
                  {assignedAuditors.map((auditor) => {
                    const operationKey = `${document.id}:${auditor}`;
                    return (
                      <div key={auditor} className="evidence-access-row">
                        <CopyableText value={auditor} label="Copy auditor" />
                        <button
                          type="button"
                          disabled={delegationPending === operationKey}
                          onClick={() => onGrantAccess(document.id, auditor)}
                        >
                          {delegationPending === operationKey ? "Working..." : "Grant"}
                        </button>
                        <button
                          type="button"
                          disabled={delegationPending === operationKey}
                          onClick={() => onRevokeAccess(document.id, auditor)}
                        >
                          Revoke
                        </button>
                      </div>
                    );
                  })}
                  <p className="muted-text">
                    Revocation blocks future proxy transformations; it cannot erase
                    plaintext an auditor already downloaded.
                  </p>
                </details>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
