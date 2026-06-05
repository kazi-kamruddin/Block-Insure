import { useState } from "react";

import CopyableText from "../components/CopyableText";
import IpfsLink from "../components/IpfsLink";
import { getClaimDocumentHash } from "../services/api";
import "../styles/pages/AuditorDocumentVerificationPage.css";

function normalizeHash(value) {
  if (!value) return "";
  const text = String(value).trim().toLowerCase();
  return text.startsWith("0x") ? text : `0x${text}`;
}

function arrayBufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function calculateFileSha256(file) {
  if (!window.crypto?.subtle) {
    throw new Error("This browser does not support SubtleCrypto hashing.");
  }

  const buffer = await file.arrayBuffer();
  const digest = await window.crypto.subtle.digest("SHA-256", buffer);
  return `0x${arrayBufferToHex(digest)}`;
}

function formatTimestamp(value) {
  if (!value) return "-";
  if (value.iso) return new Date(value.iso).toLocaleString();
  if (value.unix) return new Date(Number(value.unix) * 1000).toLocaleString();
  return String(value);
}

export default function AuditorDocumentVerificationPage() {
  const [claimId, setClaimId] = useState("");
  const [file, setFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  function handleFile(nextFile) {
    setFile(nextFile || null);
    setResult(null);
    setError("");
  }

  async function handleVerify(event) {
    event.preventDefault();

    setError("");
    setResult(null);

    try {
      if (!file) {
        throw new Error("Select a document file first.");
      }

      if (!claimId.trim()) {
        throw new Error("Enter a claim ID first.");
      }

      setIsVerifying(true);

      const [localHash, claimHashData] = await Promise.all([
        calculateFileSha256(file),
        getClaimDocumentHash(claimId.trim()),
      ]);

      const storedHash = normalizeHash(claimHashData.documentHash);
      const computedHash = normalizeHash(localHash);

      setResult({
        isMatch: computedHash === storedHash,
        computedHash,
        storedHash,
        claim: claimHashData,
      });
    } catch (err) {
      console.error(err);
      setError(
        err.response?.data?.message ||
          err.response?.data?.error ||
          err.message ||
          "Document verification failed"
      );
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <section className="page-container page-auditor-document-verification">
      <h2>Document Integrity Verification</h2>

      <form className="document-verification-grid" onSubmit={handleVerify}>
        <label
          className={`document-drop-zone ${isDragging ? "is-dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            handleFile(event.dataTransfer.files?.[0]);
          }}
        >
          <span>Upload claim document</span>
          <strong>{file ? file.name : "Drop file here or browse"}</strong>
          {file ? <em>{Math.ceil(file.size / 1024)} KB</em> : null}
          <input
            type="file"
            onChange={(event) => handleFile(event.target.files?.[0])}
          />
        </label>

        <div className="card document-verify-panel">
          <label>
            Claim ID
            <input
              type="number"
              min="1"
              value={claimId}
              onChange={(event) => {
                setClaimId(event.target.value);
                setResult(null);
              }}
              placeholder="1"
              required
            />
          </label>

          <button type="submit" disabled={isVerifying}>
            {isVerifying ? "Verifying..." : "Verify Integrity"}
          </button>
        </div>
      </form>

      {error ? <p className="error-text">{error}</p> : null}

      {result ? (
        <div
          className={`card verification-result-card ${
            result.isMatch ? "is-match" : "is-mismatch"
          }`}
        >
          <div className="verification-result-head">
            <span aria-hidden="true">{result.isMatch ? "\u2713" : "X"}</span>
            <div>
              <h3>
                {result.isMatch
                  ? "Document Integrity Verified"
                  : "Hash Mismatch - Document May Have Been Tampered"}
              </h3>
              <p>
                Claim #{result.claim.claimId} committed at block{" "}
                {result.claim.blockNumber || "-"}.
              </p>
            </div>
          </div>

          <div className="hash-comparison-grid">
            <div>
              <span>Uploaded File SHA-256</span>
              <CopyableText value={result.computedHash} label="Copy hash" short />
            </div>
            <div>
              <span>Stored On-Chain Hash</span>
              <CopyableText value={result.storedHash} label="Copy hash" short />
            </div>
          </div>

          <div className="claim-integrity-grid">
            <div>
              <span>Claim ID</span>
              <strong>{result.claim.claimId}</strong>
            </div>
            <div>
              <span>Claimant Wallet</span>
              <CopyableText
                value={result.claim.claimantWallet}
                label="Copy wallet"
                short
              />
            </div>
            <div>
              <span>Submitted</span>
              <strong>{formatTimestamp(result.claim.submittedAt)}</strong>
            </div>
            <div>
              <span>Committed Block</span>
              <strong>{result.claim.blockNumber || "-"}</strong>
            </div>
          </div>

          <p>
            <strong>Stored IPFS CID:</strong>{" "}
            <IpfsLink cid={result.claim.documentCID} />
          </p>
        </div>
      ) : null}
    </section>
  );
}
