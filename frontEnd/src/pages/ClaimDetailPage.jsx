import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import ClaimStatusBadge from "../components/ClaimStatusBadge";
import EvidenceChainPanel from "../components/EvidenceChainPanel";
import EvidenceField from "../components/EvidenceField";
import IpfsLink from "../components/IpfsLink";
import OracleComparisonPanel from "../components/OracleComparisonPanel";
import PolicyEligibilityResult from "../components/PolicyEligibilityResult";
import TransactionLink from "../components/TransactionLink";
import {
  getAppealByClaim,
  getClaimById,
  getOracleResults,
  submitAppeal,
  uploadClaimDocument,
  revokeDocumentAccess,
} from "../services/api";
import {
  getWalletContract,
  getReadOnlyClaimAdjudicator,
  getReadOnlyContract,
  parseTransactionError,
  toBytes32FromBackendSha256,
} from "../services/contractService";
import {
  encryptEvidenceFile,
  createEvidenceDelegation,
  storeEvidenceKey,
} from "../services/evidenceEncryption";
import { CLAIM_ACTIONS, getClaimActionRule } from "../services/claimActionRules";
import { getClaimStatusName } from "../utils/claimStatus";
import "../styles/pages/ClaimDetailPage.css";
import { showToast } from "../services/toast";

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
  const [proposedHospitalId, setProposedHospitalId] = useState("");
  const [proposedInvoiceNumber, setProposedInvoiceNumber] = useState("");
  const [proposedClaimType, setProposedClaimType] = useState("");
  const [proposedClaimAmountEth, setProposedClaimAmountEth] = useState("");
  const [appealError, setAppealError] = useState("");
  const [appealMessage, setAppealMessage] = useState("");
  const [appealTxHash, setAppealTxHash] = useState("");
  const [isSubmittingAppeal, setIsSubmittingAppeal] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [delegationPending, setDelegationPending] = useState("");

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
  const originalEvidenceDocument = evidenceChain?.documents?.find(
    (document) => document.ipfsCID === claim?.documentCID
  );
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

  const { data: assignedAuditors = [] } = useQuery({
    queryKey: ["claimAssignedAuditors", id],
    queryFn: async () => {
      const manager = getReadOnlyContract();
      const version = await manager.claimVersion(id);
      const adjudicator = await getReadOnlyClaimAdjudicator();
      const review = await adjudicator.getReview(id, version);
      return Array.from(review.auditors || []).filter(
        (wallet) => wallet && !/^0x0{40}$/i.test(wallet)
      );
    },
    enabled: Boolean(id && claim),
    retry: false,
  });

  async function handleGrantAccess(documentId, auditor) {
    const operationKey = `${documentId}:${auditor}`;
    try {
      setDelegationPending(operationKey);
      await createEvidenceDelegation(documentId, auditor, id);
      showToast("Future evidence access delegated to the assigned auditor.", {
        title: "Access granted",
      });
    } catch (grantError) {
      showToast(grantError.response?.data?.message || grantError.message, {
        tone: "error",
        title: "Delegation failed",
      });
    } finally {
      setDelegationPending("");
    }
  }

  async function handleRevokeAccess(documentId, auditor) {
    const operationKey = `${documentId}:${auditor}`;
    try {
      setDelegationPending(operationKey);
      await revokeDocumentAccess(documentId, auditor);
      showToast("Future proxy transformations have been revoked.", {
        title: "Access revoked",
      });
    } catch (revokeError) {
      showToast(revokeError.response?.data?.message || revokeError.message, {
        tone: "error",
        title: "Revocation failed",
      });
    } finally {
      setDelegationPending("");
    }
  }

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
        const manager = await getWalletContract();
        const currentVersion = Number(await manager.claimVersion(id));
        const encryptedAppealEvidence = await encryptEvidenceFile(appealFile, {
          claimId: id,
          claimVersion: currentVersion + 1,
          uploader: claim.claimantWallet,
          evidenceType: "APPEAL_DOCUMENT",
        });
        const uploadResult = await uploadClaimDocument({
          file: encryptedAppealEvidence.encryptedFile,
          documentType: "APPEAL_DOCUMENT",
          claimId: id,
          encryption: {
            enabled: true,
            algorithm: encryptedAppealEvidence.algorithm,
            originalMimeType: encryptedAppealEvidence.originalMimeType,
            originalName: encryptedAppealEvidence.originalName,
            keyCapsule: encryptedAppealEvidence.keyCapsule,
            associatedData: encryptedAppealEvidence.associatedData,
            encryptionIdentityVersion:
              encryptedAppealEvidence.encryptionIdentityVersion,
          },
        });

        additionalDocumentHash = uploadResult.document?.sha256Hash || "";
        additionalDocumentCID = uploadResult.document?.ipfsCID || "";
        storeEvidenceKey(additionalDocumentCID, encryptedAppealEvidence);
      }

      const contract = await getWalletContract();
      const tx = additionalDocumentHash
        ? await contract.submitAppealWithEvidence(
            id,
            appealReasonHash,
            toBytes32FromBackendSha256(additionalDocumentHash),
            additionalDocumentCID
          )
        : await contract.submitAppeal(id, appealReasonHash);

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
        proposedHospitalId: proposedHospitalId.trim(),
        proposedInvoiceNumber: proposedInvoiceNumber.trim(),
        proposedClaimType: proposedClaimType.trim(),
        proposedClaimAmountEth: proposedClaimAmountEth.trim(),
      });

      setAppealReason("");
      setAppealDescription("");
      setAppealFile(null);
      setProposedHospitalId("");
      setProposedInvoiceNumber("");
      setProposedClaimType("");
      setProposedClaimAmountEth("");
      setAppealMessage("Appeal submitted successfully.");
      showToast(`Appeal for claim #${id} submitted successfully.`, {
        title: "Appeal submitted",
      });
      await refetchAppeal();
      await refetch();
    } catch (err) {
      console.error(err);
      const message = parseTransactionError(err);
      setAppealError(message);
      showToast(message, { tone: "error", title: "Appeal failed" });
    } finally {
      setIsSubmittingAppeal(false);
    }
  }

  async function handleWithdrawSettlement() {
    try {
      setIsWithdrawing(true);
      const contract = await getWalletContract();
      const tx = await contract.withdrawSettlement(id);
      await tx.wait();
      showToast(`Settlement for claim #${id} withdrawn.`, { title: "Payment received" });
      await refetch();
    } catch (error) {
      showToast(parseTransactionError(error), { tone: "error", title: "Withdrawal failed" });
    } finally {
      setIsWithdrawing(false);
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

      <div className="claim-detail-workspace">
      {claim ? (
        <div className="card">
          <span className="section-eyebrow">Claim overview</span>
          <h3>
            {claim.displayTitle ||
              `${claim.packageName || "Insurance claim"} · Claim #${formatValue(
                claim.claimId || id
              )}`}
          </h3>

          <p>Amount: {formatValue(claim.claimAmountEth || claim.claimAmount)} ETH</p>
          <p>Claim type: {formatValue(claim.claimType)}</p>
          <p>Hospital ID: {formatValue(claim.hospitalId)}</p>
          <p>
            Status: <ClaimStatusBadge status={statusName} showHelp />
          </p>
          <p>
            On-chain validation score:{" "}
              {claim.verificationConfidenceAvailable === false
              ? "Not calculated"
                : `${formatValue(claim.verificationConfidence)}/100`}
          </p>
          <p className="muted-text">
            Higher values mean the on-chain duplicate checks found fewer
            warning signals. This is not the oracle fraud probability.
          </p>
          <p>
            Submitted:{" "}
            {formatDate(claim.submittedAtFormatted || claim.submittedAt)}
          </p>
          {claim.fraudReason ? (
            <p className="error-text">
              <strong>Flag reason:</strong> {claim.fraudReason}
            </p>
          ) : null}
          <PolicyEligibilityResult
            evaluation={claim.policyEligibility?.evaluation}
            title="Submission-time policy assessment"
          />

          <details className="technical-details">
            <summary>Policy and wallet identifiers</summary>
            <p>Policy ID: {formatValue(claim.policyId)}</p>
            <p>Claimant wallet: {formatValue(claim.claimantWallet)}</p>
          </details>

          <h3>Evidence</h3>
          <p className="muted-text">
            Files are encrypted. The hash chain verifies integrity; the oracle
            or an authorized reviewer still determines whether the content is
            valid.
          </p>
          <details className="technical-details">
            <summary>Original evidence identifiers</summary>
            <EvidenceField label="Invoice hash" value={claim.invoiceHash} />
            <EvidenceField label="Document hash" value={claim.documentHash} />
            <p>
              <strong>Encrypted IPFS object:</strong>{" "}
              <IpfsLink
                cid={claim.documentCID}
                documentId={originalEvidenceDocument?.id}
                recoverable={originalEvidenceDocument?.recoverableAcrossBrowsers}
                sha256Hash={originalEvidenceDocument?.sha256Hash}
              />
            </p>
          </details>
          <EvidenceChainPanel
            evidenceChain={evidenceChain}
            assignedAuditors={assignedAuditors}
            onGrantAccess={handleGrantAccess}
            onRevokeAccess={handleRevokeAccess}
            delegationPending={delegationPending}
          />
        </div>
      ) : null}

      {statusName === "PAYOUT_READY" ? (
        <div className="card">
          <h3>Payment ready</h3>
          <p>Your settlement is allocated in the protocol payout vault.</p>
          <button type="button" onClick={handleWithdrawSettlement} disabled={isWithdrawing}>
            {isWithdrawing ? "Withdrawing..." : "Withdraw Payment"}
          </button>
        </div>
      ) : null}

      {statusName === "FUNDING_REQUIRED" ? (
        <div className="card">
          <h3>Funding required</h3>
          <p>This claim is valid. It is waiting for treasury backing and has not been rejected.</p>
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

              <fieldset>
                <legend>Corrected claim information (optional)</legend>
                <p className="muted-text">
                  Enter only information that was wrong originally. If the
                  appeal is approved, the next oracle round will use these
                  corrections and identify them as appeal-supplied data.
                </p>
                <label>
                  Correct hospital ID
                  <input
                    value={proposedHospitalId}
                    onChange={(event) => setProposedHospitalId(event.target.value)}
                    placeholder={claim?.hospitalId || "HOSP-001"}
                  />
                </label>
                <label>
                  Correct invoice number
                  <input
                    value={proposedInvoiceNumber}
                    onChange={(event) =>
                      setProposedInvoiceNumber(event.target.value)
                    }
                    placeholder="INV-HOSP-001-001"
                  />
                </label>
                <label>
                  Correct claim type
                  <input
                    value={proposedClaimType}
                    onChange={(event) => setProposedClaimType(event.target.value)}
                    placeholder={claim?.claimType || "HOSPITALIZATION"}
                  />
                </label>
                <label>
                  Correct claim amount in ETH
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={proposedClaimAmountEth}
                    onChange={(event) =>
                      setProposedClaimAmountEth(event.target.value)
                    }
                    placeholder={claim?.claimAmountEth || "0.1"}
                  />
                </label>
              </fieldset>

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
      </div>

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
