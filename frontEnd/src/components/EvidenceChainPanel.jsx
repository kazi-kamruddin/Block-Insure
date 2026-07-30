import CopyableText from "./CopyableText";
import IpfsLink from "./IpfsLink";

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

export default function EvidenceChainPanel({ evidenceChain }) {
  const documents = evidenceChain?.documents || [];

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
                />
              </p>
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
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
