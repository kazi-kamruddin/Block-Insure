import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import ClaimStatusBadge from "../components/ClaimStatusBadge";
import EvidenceChainPanel from "../components/EvidenceChainPanel";
import EvidenceField from "../components/EvidenceField";
import IpfsLink from "../components/IpfsLink";
import OracleComparisonPanel from "../components/OracleComparisonPanel";
import TransactionLink from "../components/TransactionLink";
import {
  getAppealByClaim,
  getClaimById,
  getOracleResults,
  submitAppeal,
  uploadClaimDocument,
} from "../services/api";
import { getWalletContract, parseTransactionError } from "../services/contractService";
import {
  encryptEvidenceFile,
  storeEvidenceKey,
} from "../services/evidenceEncryption";
import { CLAIM_ACTIONS, getClaimActionRule } from "../services/claimActionRules";
import { getClaimStatusName } from "../utils/claimStatus";
import "../styles/pages/ClaimDetailPage.css";

function extractClaim(data) {
  return data?.claim || data?.data?.claim || data?.data || data;
}

function extractOracleLogs(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.logs)) return data.logs;
  if (Array.isArray(data?.oracleLogs)) return data.oracleLogs;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function extractEvidenceChain(data) {
  return data?.evidenceChain || data?.data?.evidenceChain || null;
}

function formatValue(value) {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

async function hashAppealReason(reason) {
  const encoded = new TextEncoder().encode(reason);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return `0x${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

export default function ClaimDetailPage() {
  const { id } = useParams();
  const [appealReason, setAppealReason] = useState("");
  const [appealReasonCategory, setAppealReasonCategory] = useState("DOCUMENT_ERROR");
  const [appealDescription, setAppealDescription] = useState("");
  const [appealFile, setAppealFile] = useState(null);
  const [appealError, setAppealError] = useState("");
  const [appealMessage, setAppealMessage] = useState("");
  const [appealTxHash, setAppealTxHash] = useState("");
  const [isSubmittingAppeal, setIsSubmittingAppeal] = useState(false);

  const {
    data: claimData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["claim", id],
    queryFn: () => getClaimById(id),
    enabled: Boolean(id),
  });

  const {
    data: oracleData,
    isLoading: oracleLoading,
    refetch: refetchOracle,
  } = useQuery({
    queryKey: ["oracleResults", id],
    queryFn: () => getOracleResults(id),
    enabled: Boolean(id),
  });

  const {
    data: appealData,
    isLoading: appealLoading,
    refetch: refetchAppeal,
  } = useQuery({
    queryKey: ["claimAppeal", id],
    queryFn: async () => {
      try {
        return await getAppealByClaim(id);
      } catch (err) {
        if (err.response?.status === 404) {
          return null;
        }

        throw err;
      }
    },
    enabled: Boolean(id),
    retry: false,
  });

  const claim = extractClaim(claimData);
  const evidenceChain = extractEvidenceChain(claimData);
  const oracleLogs = extractOracleLogs(oracleData);
  const backendQuorumSummary = oracleData?.quorumSummary || oracleData?.data?.quorumSummary;
  const statusName = getClaimStatusName(claim);
  const appeal = appealData?.appeal || null;
  const appealRule = getClaimActionRule({
    action: CLAIM_ACTIONS.APPEAL,
    statusName,
    appealAlreadyUsed: Boolean(appeal),
  });
  const canAppeal = appealRule.allowed;

  async function handleSubmitAppeal(event) {
    event.preventDefault();
    setAppealError("");
    setAppealMessage("");
    setAppealTxHash("");

    const trimmedReason = appealReason.trim();

    if (!trimmedReason) {
      setAppealError("Enter an appeal reason first.");
      return;
    }

    try {
      setIsSubmittingAppeal(true);

      const appealReasonHash = await hashAppealReason(trimmedReason);
      let additionalDocumentHash = "";
      let additionalDocumentCID = "";

      if (appealFile) {
        const encryptedAppealEvidence = await encryptEvidenceFile(appealFile);
        const uploadResult = await uploadClaimDocument({
          file: encryptedAppealEvidence.encryptedFile,
          documentType: "APPEAL_DOCUMENT",
          claimId: id,
          encryption: {
            enabled: true,
            algorithm: encryptedAppealEvidence.algorithm,
            originalMimeType: encryptedAppealEvidence.originalMimeType,
          },
        });

        additionalDocumentHash = uploadResult.document?.sha256Hash || "";
        additionalDocumentCID = uploadResult.document?.ipfsCID || "";
        storeEvidenceKey(additionalDocumentCID, encryptedAppealEvidence);
      }

      const contract = await getWalletContract();
      const tx = await contract.submitAppeal(id, appealReasonHash);

      setAppealTxHash(tx.hash);

      await tx.wait();

      await submitAppeal({
        claimId: id,
        appealReason: trimmedReason,
        reasonCategory: appealReasonCategory,
        appealDescription: appealDescription.trim() || trimmedReason,
        appealReasonHash,
        additionalDocumentHash,
        additionalDocumentCID,
        transactionHash: tx.hash,
      });

      setAppealReason("");
      setAppealDescription("");
      setAppealFile(null);
      setAppealMessage("Appeal submitted successfully.");
      await refetchAppeal();
      await refetch();
    } catch (err) {
      console.error(err);
      setAppealError(parseTransactionError(err));
    } finally {
      setIsSubmittingAppeal(false);
    }
  }

  return (
    <section className="page-container page-claim-detail">
      <h2>Claim Detail</h2>

      <button
        type="button"
        onClick={() => {
          refetch();
          refetchOracle();
          refetchAppeal();
        }}
      >
        Refresh Claim
      </button>

      <p>
        <Link to="/user/claims">Back to My Claims</Link>
      </p>

      {isLoading ? <p>Loading claim...</p> : null}

      {error ? (
        <p className="error-text">
          {error.message || "Could not load claim detail"}
        </p>
      ) : null}

      {claim ? (
        <div className="card">
          <h3>Claim #{formatValue(claim.claimId || id)}</h3>

          <p>Policy ID: {formatValue(claim.policyId)}</p>
          <p>Claimant: {formatValue(claim.claimantWallet)}</p>
          <p>Amount: {formatValue(claim.claimAmountEth || claim.claimAmount)} ETH</p>
          <p>Claim type: {formatValue(claim.claimType)}</p>
          <p>Hospital ID: {formatValue(claim.hospitalId)}</p>
          <p>
            Status: <ClaimStatusBadge status={statusName} showHelp />
          </p>
          <p>Risk score: {formatValue(claim.riskScore)}</p>
          <p>Submitted at: {formatValue(claim.submittedAtFormatted || claim.submittedAt)}</p>

          <h3>Evidence</h3>
          <EvidenceField label="Invoice hash" value={claim.invoiceHash} />
          <EvidenceField label="Document hash" value={claim.documentHash} />
          <p>
            <strong>Document CID:</strong> <IpfsLink cid={claim.documentCID} />
          </p>
          <EvidenceChainPanel evidenceChain={evidenceChain} />
        </div>
      ) : null}

      {claim ? (
        <div className="card appeal-card">
          <h3>Appeal</h3>

          {appealLoading ? <p>Loading appeal status...</p> : null}

          {appeal ? (
            <div className="appeal-status">
              <p>
                Status: <span className={`appeal-pill appeal-${appeal.status?.toLowerCase()}`}>{appeal.status}</span>
              </p>
              <p>Submitted: {formatDate(appeal.submittedAt)}</p>
              <p>Appeal deadline: {formatDate(appeal.appealDeadline)}</p>
              <p>Category: {formatValue(appeal.reasonCategory)}</p>
              <p>Reason: {formatValue(appeal.appealReason)}</p>
              <p>Description: {formatValue(appeal.appealDescription)}</p>
              {appeal.additionalDocumentCID ? (
                <p>
                  Additional document:{" "}
                  <IpfsLink cid={appeal.additionalDocumentCID} />
                </p>
              ) : null}
              {appeal.adminNote ? <p>Admin note: {appeal.adminNote}</p> : null}
              {appeal.auditorRecommendation ? (
                <p>Auditor recommendation: {appeal.auditorRecommendation}</p>
              ) : null}
              {appeal.finalRejectionReason ? (
                <p>Final rejection reason: {appeal.finalRejectionReason}</p>
              ) : null}
              {appeal.transactionHash ? (
                <p>
                  Appeal tx: <TransactionLink txHash={appeal.transactionHash} />
                </p>
              ) : null}
            </div>
          ) : null}

          {canAppeal ? (
            <form className="appeal-form" onSubmit={handleSubmitAppeal}>
              <label>
                Appeal category
                <select
                  value={appealReasonCategory}
                  onChange={(event) => setAppealReasonCategory(event.target.value)}
                >
                  <option value="DOCUMENT_ERROR">Document error</option>
                  <option value="ORACLE_DISAGREEMENT">Oracle disagreement</option>
                  <option value="SETTLEMENT_DISPUTE">Settlement dispute</option>
                  <option value="ADMIN_REVIEW">Admin review requested</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>

              <label>
                Appeal reason
                <textarea
                  value={appealReason}
                  onChange={(event) => setAppealReason(event.target.value)}
                  rows={5}
                  placeholder="Explain why this rejected claim should be reviewed again."
                />
              </label>

              <label>
                Appeal description
                <textarea
                  value={appealDescription}
                  onChange={(event) => setAppealDescription(event.target.value)}
                  rows={4}
                  placeholder="Add structured context for admin/auditor review."
                />
              </label>

              <label>
                Additional document
                <input
                  type="file"
                  onChange={(event) => setAppealFile(event.target.files?.[0] || null)}
                />
              </label>

              <button type="submit" disabled={isSubmittingAppeal}>
                {isSubmittingAppeal ? "Submitting Appeal..." : "Appeal This Decision"}
              </button>
            </form>
          ) : null}

          {!appeal && statusName !== "REJECTED" ? (
            <p>{appealRule.reason || "Appeals are available after a claim is rejected."}</p>
          ) : null}

          {appeal?.history?.length ? (
            <div>
              <h4>Appeal history</h4>
              {appeal.history.map((entry, index) => (
                <p key={`${entry.status}-${entry.timestamp || index}`}>
                  {formatDate(entry.timestamp)} - {entry.status} by{" "}
                  {formatValue(entry.actorRole)} {entry.note ? `- ${entry.note}` : ""}
                </p>
              ))}
            </div>
          ) : null}

          {appealError ? <p className="error-text">{appealError}</p> : null}
          {appealMessage ? <p className="success-text">{appealMessage}</p> : null}
          {appealTxHash ? (
            <p>
              Appeal transaction: <TransactionLink txHash={appealTxHash} />
            </p>
          ) : null}
        </div>
      ) : null}

      <h3>Oracle Results</h3>

      {oracleLoading ? <p>Loading oracle logs...</p> : null}

      {!oracleLoading ? (
        <OracleComparisonPanel
          logs={oracleLogs}
          quorumSummary={backendQuorumSummary}
        />
      ) : null}
    </section>
  );
}
