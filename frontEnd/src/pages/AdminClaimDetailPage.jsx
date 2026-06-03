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
  approveClaim,
  finalizeClaimVoting,
  getAppealByClaim,
  getClaimById,
  getClaimVoteSummary,
  getOracleResults,
  rejectClaim,
  reviewAppeal,
  requestOracleVerification,
  sendClaimToManualReview,
  settleClaim,
} from "../services/api";
import {
  formatEth,
  getReadOnlyContract,
} from "../services/contractService";
import { getClaimStatusName } from "../utils/claimStatus";
import "../styles/pages/AdminClaimDetailPage.css";

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

function getTransactionHash(result) {
  return (
    result?.txHash ||
    result?.transactionHash ||
    result?.transactionHashes?.[0] ||
    result?.data?.txHash ||
    result?.data?.transactionHash ||
    result?.data?.transactionHashes?.[0] ||
    result?.claim?.txHash ||
    result?.oracleRequest?.txHash ||
    ""
  );
}

function extractVoteSummary(data) {
  return data?.voteSummary || data?.data?.voteSummary || null;
}

function formatPercent(value) {
  const numericValue = Number(value || 0);
  return `${Math.round(numericValue * 100)}%`;
}

async function getContractReserveBalance() {
  const contract = getReadOnlyContract();
  const balance = await contract.getContractBalance();
  return formatEth(balance);
}

export default function AdminClaimDetailPage() {
  const { id } = useParams();

  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionTxHash, setActionTxHash] = useState("");
  const [isActing, setIsActing] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [appealAdminNote, setAppealAdminNote] = useState("");

  const {
    data: claimData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["adminClaim", id],
    queryFn: () => getClaimById(id),
    enabled: Boolean(id),
  });

  const {
    data: oracleData,
    isLoading: oracleLoading,
    refetch: refetchOracle,
  } = useQuery({
    queryKey: ["adminOracleResults", id],
    queryFn: () => getOracleResults(id),
    enabled: Boolean(id),
  });

  const {
    data: appealData,
    isLoading: appealLoading,
    refetch: refetchAppeal,
  } = useQuery({
    queryKey: ["adminClaimAppeal", id],
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

  const {
    data: reserveBalance,
    isLoading: reserveLoading,
    refetch: refetchReserve,
  } = useQuery({
    queryKey: ["contractReserveBalance"],
    queryFn: getContractReserveBalance,
  });

  const {
    data: voteData,
    isLoading: voteLoading,
    refetch: refetchVotes,
  } = useQuery({
    queryKey: ["adminClaimVoteSummary", id],
    queryFn: () => getClaimVoteSummary(id),
    enabled: Boolean(id),
  });

  const claim = extractClaim(claimData);
  const evidenceChain = extractEvidenceChain(claimData);
  const oracleLogs = extractOracleLogs(oracleData);
  const statusName = getClaimStatusName(claim);
  const appeal = appealData?.appeal || null;
  const voteSummary = extractVoteSummary(voteData);

  const canRequestOracle = statusName === "DUPLICATE_CHECKED";
  const canSendManualReview =
    statusName === "ORACLE_FAILED" || statusName === "FRAUD_FLAGGED";
  const canApprove =
    statusName === "ORACLE_VERIFIED" || statusName === "MANUAL_REVIEW";
  const canReject =
    statusName !== "SETTLED" &&
    statusName !== "CLOSED" &&
    statusName !== "REJECTED" &&
    statusName !== "UNKNOWN";
  const canSettle = statusName === "APPROVED";
  const canShowVoting =
    statusName === "MANUAL_REVIEW" || statusName === "ORACLE_FAILED";

  async function refreshAll() {
    await refetch();
    await refetchOracle();
    await refetchReserve();
    await refetchAppeal();
    await refetchVotes();
  }

  async function runAdminAction(actionFn, successText) {
    setActionError("");
    setActionMessage("");
    setActionTxHash("");

    try {
      setIsActing(true);

      const result = await actionFn();

      setActionTxHash(getTransactionHash(result));
      setActionMessage(successText);

      await refreshAll();
    } catch (err) {
      console.error(err);
      setActionError(
        err.response?.data?.message ||
          err.response?.data?.error ||
          err.message ||
          "Admin action failed"
      );
    } finally {
      setIsActing(false);
    }
  }

  function handleRequestOracle() {
    runAdminAction(
      () => requestOracleVerification(id),
      "Oracle verification requested successfully."
    );
  }

  function handleManualReview() {
    runAdminAction(
      () => sendClaimToManualReview(id),
      "Claim sent to manual review successfully."
    );
  }

  function handleApprove() {
    runAdminAction(() => approveClaim(id), "Claim approved successfully.");
  }

  function handleReject() {
    if (!rejectReason.trim()) {
      setActionError("Enter a rejection reason first.");
      return;
    }

    runAdminAction(
      () => rejectClaim(id, rejectReason.trim()),
      "Claim rejected successfully."
    );
  }

  function handleSettle() {
    const confirmed = window.confirm(
      "Settle this claim now? This will transfer ETH from the contract reserve to the claimant."
    );

    if (!confirmed) return;

    runAdminAction(() => settleClaim(id), "Claim settled successfully.");
  }

  function handleReviewAppeal(status) {
    if (!appeal?.id) return;

    runAdminAction(
      () =>
        reviewAppeal(appeal.id, {
          status,
          adminNote: appealAdminNote.trim(),
        }),
      `Appeal marked ${status.toLowerCase().replace("_", " ")} successfully.`
    );
  }

  function handleFinalizeVoting() {
    runAdminAction(
      () => finalizeClaimVoting(id),
      "Voting finalized and auditor reputations updated successfully."
    );
  }

  return (
    <section className="page-container page-admin-claim-detail">
      <h2>Admin Claim Detail</h2>

      <p>
        <Link to="/admin/claims">Back to Admin Claims</Link>
      </p>

      <button type="button" onClick={refreshAll}>
        Refresh Claim
      </button>

      <div className="card">
        <h3>Contract Reserve</h3>
        <p>{reserveLoading ? "Loading..." : `${reserveBalance} ETH`}</p>
        <p>This is the central payout reserve used during claim settlement.</p>
      </div>

      {isLoading ? <p>Loading claim...</p> : null}

      {error ? (
        <p className="error-text">
          {error.message || "Could not load claim detail"}
        </p>
      ) : null}

      {actionError ? <p className="error-text">{actionError}</p> : null}
      {actionMessage ? <p className="success-text">{actionMessage}</p> : null}

      {actionTxHash ? (
        <p>
          Action transaction: <TransactionLink txHash={actionTxHash} />
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

          <h3>Evidence</h3>
          <EvidenceField label="Invoice hash" value={claim.invoiceHash} />
          <EvidenceField label="Document hash" value={claim.documentHash} />
          <p>
            <strong>Document CID:</strong> <IpfsLink cid={claim.documentCID} />
          </p>
          <EvidenceChainPanel evidenceChain={evidenceChain} />
        </div>
      ) : null}

      <div className="card">
        <h3>Admin Actions</h3>

        <p>
          Current status: <strong>{statusName}</strong>
        </p>

        <div className="action-row">
          <button
            type="button"
            onClick={handleRequestOracle}
            disabled={!canRequestOracle || isActing}
          >
            Request Oracle Verification
          </button>

          <button
            type="button"
            onClick={handleManualReview}
            disabled={!canSendManualReview || isActing}
          >
            Send to Manual Review
          </button>

          <button
            type="button"
            onClick={handleApprove}
            disabled={!canApprove || isActing}
          >
            Approve Claim
          </button>

          <button
            type="button"
            onClick={handleSettle}
            disabled={!canSettle || isActing}
          >
            Settle Claim
          </button>
        </div>

        <div className="form-grid">
          <label>
            Rejection reason
            <input
              type="text"
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder="Example: Duplicate invoice/document evidence detected"
            />
          </label>

          <button
            type="button"
            onClick={handleReject}
            disabled={!canReject || isActing}
          >
            Reject Claim
          </button>
        </div>
      </div>

      {canShowVoting ? (
        <div className="card voting-summary-card">
          <h3>Voting Summary</h3>

          {voteLoading ? <p>Loading voting summary...</p> : null}

          {voteSummary ? (
            <>
              <div className="voting-metric-row">
                <div>
                  <span>Total voters</span>
                  <strong>{voteSummary.totalVoters || 0}</strong>
                </div>
                <div>
                  <span>Weighted consensus</span>
                  <strong>{voteSummary.consensusDisplayLabel || "No Consensus"}</strong>
                </div>
                <div>
                  <span>Consensus strength</span>
                  <strong>{formatPercent(voteSummary.consensusStrength)}</strong>
                </div>
              </div>

              <div className="vote-breakdown-grid">
                {Object.values(voteSummary.breakdown || {}).map((entry) => (
                  <div className="vote-breakdown-item" key={entry.label}>
                    <strong>{entry.displayLabel}</strong>
                    <span>{entry.count} votes</span>
                    <span>Weight {entry.weightedSum}</span>
                  </div>
                ))}
              </div>

              {voteSummary.voters?.length > 0 ? (
                <table className="voter-table">
                  <thead>
                    <tr>
                      <th>Auditor</th>
                      <th>Vote</th>
                      <th>Reputation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {voteSummary.voters.map((voter) => (
                      <tr key={voter.auditorAddress}>
                        <td>{voter.shortenedAddress}</td>
                        <td>{voter.voteDisplayLabel}</td>
                        <td>{voter.reputation}/100</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p>No auditor votes have been cast yet.</p>
              )}

              <button
                type="button"
                onClick={handleFinalizeVoting}
                disabled={
                  isActing ||
                  !voteSummary.totalVoters ||
                  voteSummary.isTie ||
                  !voteSummary.consensusCode
                }
              >
                Finalize Voting & Update Reputations
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="card appeal-review-card">
        <h3>Appeal</h3>

        {appealLoading ? <p>Loading appeal...</p> : null}

        {!appealLoading && !appeal ? (
          <p>No appeal has been submitted for this claim.</p>
        ) : null}

        {appeal ? (
          <>
            <p>
              Status:{" "}
              <span className={`appeal-pill appeal-${appeal.status?.toLowerCase()}`}>
                {appeal.status}
              </span>
            </p>
            <p>Submitted: {formatValue(appeal.submittedAt)}</p>
            <p>Claimant: {formatValue(appeal.claimantWallet)}</p>
            <p>Reason: {formatValue(appeal.appealReason)}</p>
            <EvidenceField label="Appeal reason hash" value={appeal.appealReasonHash} />
            {appeal.additionalDocumentHash ? (
              <EvidenceField
                label="Additional document hash"
                value={appeal.additionalDocumentHash}
              />
            ) : null}
            {appeal.additionalDocumentCID ? (
              <p>
                Additional document: <IpfsLink cid={appeal.additionalDocumentCID} />
              </p>
            ) : null}
            {appeal.transactionHash ? (
              <p>
                Appeal tx: <TransactionLink txHash={appeal.transactionHash} />
              </p>
            ) : null}

            <div className="form-grid">
              <label>
                Admin note
                <input
                  type="text"
                  value={appealAdminNote}
                  onChange={(event) => setAppealAdminNote(event.target.value)}
                  placeholder={appeal.adminNote || "Optional appeal review note"}
                />
              </label>
            </div>

            <div className="action-row">
              <button
                type="button"
                onClick={() => handleReviewAppeal("UNDER_REVIEW")}
                disabled={isActing}
              >
                Mark Under Review
              </button>
              <button
                type="button"
                onClick={() => handleReviewAppeal("APPROVED")}
                disabled={isActing}
              >
                Approve Appeal
              </button>
              <button
                type="button"
                onClick={() => handleReviewAppeal("REJECTED")}
                disabled={isActing}
              >
                Reject Appeal
              </button>
            </div>
          </>
        ) : null}
      </div>

      <h3>Oracle Results</h3>

      {oracleLoading ? <p>Loading oracle logs...</p> : null}

      {!oracleLoading && oracleLogs.length === 0 ? (
        <p>No oracle result found yet.</p>
      ) : null}

      {oracleLogs.map((log) => (
        <div className="card" key={log._id || log.requestId || log.resultHash}>
          <p>Request ID: {formatValue(log.requestId)}</p>
          <p>Verified: {formatValue(log.verified)}</p>
          <p>Risk level: {formatValue(log.riskLevel)}</p>
          <EvidenceField label="Result hash" value={log.resultHash} />
          <p>
            Tx hash: <TransactionLink txHash={log.submittedTxHash || log.txHash} />
          </p>
          <OracleComparisonPanel log={log} />
        </div>
      ))}
    </section>
  );
}
