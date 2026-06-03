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
                <strong>Link #{formatValue(document.evidenceChainIndex)}</strong>
                <span>{document.chainLinkVerified ? "VALID" : "CHECK"}</span>
              </div>

              <p>{formatValue(document.originalName)}</p>
              <p>Type: {formatValue(document.documentType)}</p>
              <p>Uploaded: {formatDate(document.uploadedAt)}</p>
              <p>
                IPFS: <IpfsLink cid={document.ipfsCID} />
              </p>
              <p>
                File hash:{" "}
                <CopyableText value={document.sha256Hash} label="Copy hash" />
              </p>
              <p>
                Previous:{" "}
                <CopyableText
                  value={document.previousEvidenceHash}
                  label="Copy previous"
                />
              </p>
              <p>
                Chain hash:{" "}
                <CopyableText
                  value={document.evidenceChainHash}
                  label="Copy chain hash"
                />
              </p>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
