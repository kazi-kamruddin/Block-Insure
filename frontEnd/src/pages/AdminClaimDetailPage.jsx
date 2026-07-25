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
  approveHighValueSettlement,
  closeClaim,
  finalizeClaimVoting,
  getAppealByClaim,
  getClaimById,
  getClaimVoteSummary,
  getOracleResults,
  rejectClaim,
  resolveOracleTimeout,
  reviewAppeal,
  requestOracleVerification,
  sendClaimToManualReview,
  settleClaim,
} from "../services/api";
import {
  getContractBalance,
  formatEth,
  getReadOnlyContract,
  parseTransactionError,
} from "../services/contractService";
import { CLAIM_ACTIONS, getClaimActionRule } from "../services/claimActionRules";
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

function formatBpsPercent(value) {
  const numericValue = Number(value || 0) / 100;
  return `${numericValue.toFixed(2).replace(/\.00$/, "")}%`;
}

async function getContractReserveBalance() {
  const balance = await getContractBalance();
  return formatEth(balance);
}

async function getSettlementBreakdown(claimId) {
  const contract = getReadOnlyContract();
  const [
    settlement,
    deductibleRateBps,
    deductibleCapWei,
    insurerShareBps,
    reserveWarningThresholdWei,
    highValueSettlementThresholdWei,
    highValueSettlementApproved,
    highValueSettlementApprover,
  ] =
    await Promise.all([
      contract.calculateSettlement(claimId),
      contract.deductibleRateBps(),
      contract.deductibleCapWei(),
      contract.insurerShareBps(),
      contract.reserveWarningThresholdWei(),
      contract.highValueSettlementThresholdWei(),
      contract.highValueSettlementApproved(claimId),
      contract.highValueSettlementApprover(claimId),
    ]);
  const reserveWei = await getContractBalance();
  const reserveAfterWei =
    reserveWei >= settlement.insurerPays ? reserveWei - settlement.insurerPays : 0n;

  return {
    claimAmountWei: settlement.claimAmount.toString(),
    claimAmountEth: formatEth(settlement.claimAmount),
    deductibleWei: settlement.deductible.toString(),
    deductibleEth: formatEth(settlement.deductible),
    afterDeductibleWei: settlement.afterDeductible.toString(),
    afterDeductibleEth: formatEth(settlement.afterDeductible),
    insurerPaysWei: settlement.insurerPays.toString(),
    insurerPaysEth: formatEth(settlement.insurerPays),
    claimantResponsibilityWei: settlement.claimantResponsibility.toString(),
    claimantResponsibilityEth: formatEth(settlement.claimantResponsibility),
    reserveGate: {
      reserveWei: reserveWei.toString(),
      reserveEth: formatEth(reserveWei),
      reserveAfterWei: reserveAfterWei.toString(),
      reserveAfterEth: formatEth(reserveAfterWei),
      warningThresholdWei: reserveWarningThresholdWei.toString(),
      warningThresholdEth: formatEth(reserveWarningThresholdWei),
      belowWarningThreshold: reserveAfterWei < reserveWarningThresholdWei,
      highValueThresholdWei: highValueSettlementThresholdWei.toString(),
      highValueThresholdEth: formatEth(highValueSettlementThresholdWei),
      highValueApprovalRequired:
        settlement.insurerPays > highValueSettlementThresholdWei,
      highValueSettlementApproved: Boolean(highValueSettlementApproved),
      highValueSettlementApprover,
    },
    params: {
      deductibleRateBps: deductibleRateBps.toString(),
      deductibleRatePercent: formatBpsPercent(deductibleRateBps),
      deductibleCapWei: deductibleCapWei.toString(),
      deductibleCapEth: formatEth(deductibleCapWei),
      insurerShareBps: insurerShareBps.toString(),
      insurerSharePercent: formatBpsPercent(insurerShareBps),
    },
  };
}

async function getOracleQuorumStatus(claimId) {
  const contract = getReadOnlyContract();
  const oracleRequest = await contract.getOracleRequestByClaimId(claimId);
  const [confirmations, required] = await Promise.all([
    contract.oracleConfirmationCount(oracleRequest.requestId),
    contract.oracleQuorumThreshold(),
  ]);

  return {
    requestId: oracleRequest.requestId.toString(),
    confirmations: Number(confirmations),
    required: Number(required),
    finalized: Boolean(oracleRequest.isFulfilled),
  };
}

export default function AdminClaimDetailPage() {
  const { id } = useParams();

  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionTxHash, setActionTxHash] = useState("");
  const [isActing, setIsActing] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [appealAdminNote, setAppealAdminNote] = useState("");
  const [appealAuditorRecommendation, setAppealAuditorRecommendation] = useState("");
  const [appealFinalRejectionReason, setAppealFinalRejectionReason] = useState("");

  const {
    data: claimData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["adminClaim", id],
    queryFn: () => getClaimById(id),
    enabled: Boolean(id),
    refetchInterval: 1200,
    refetchIntervalInBackground: true,
  });

  const {
    data: oracleData,
    isLoading: oracleLoading,
    refetch: refetchOracle,
  } = useQuery({
    queryKey: ["adminOracleResults", id],
    queryFn: () => getOracleResults(id),
    enabled: Boolean(id),
    refetchInterval: 1200,
    refetchIntervalInBackground: true,
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

  const {
    data: settlementBreakdown,
    isLoading: settlementLoading,
    refetch: refetchSettlementBreakdown,
  } = useQuery({
    queryKey: ["adminClaimSettlementBreakdown", id],
    queryFn: () => getSettlementBreakdown(id),
    enabled: Boolean(id),
  });

  const claim = extractClaim(claimData);
  const evidenceChain = extractEvidenceChain(claimData);
  const oracleLogs = extractOracleLogs(oracleData);
  const backendQuorumSummary = oracleData?.quorumSummary || oracleData?.data?.quorumSummary;
  const statusName = getClaimStatusName(claim);

  const {
    data: oracleQuorumStatus,
    isLoading: quorumLoading,
    refetch: refetchOracleQuorumStatus,
  } = useQuery({
    queryKey: ["adminClaimOracleQuorum", id],
    queryFn: () => getOracleQuorumStatus(id),
    enabled: Boolean(id) && statusName === "ORACLE_PENDING",
    retry: false,
    refetchInterval: statusName === "ORACLE_PENDING" ? 900 : false,
    refetchIntervalInBackground: true,
  });

  const appeal = appealData?.appeal || null;
  const voteSummary = extractVoteSummary(voteData);
  const appealIsFinal =
    appeal?.status === "APPROVED" || appeal?.status === "REJECTED";

  const getAdminRule = (action, extra = {}) =>
    getClaimActionRule({
      action,
      statusName,
      role: "ADMIN",
      alreadySettled: statusName === "SETTLED" && action !== CLAIM_ACTIONS.CLOSE,
      ...extra,
    });
  const requestOracleRule = getAdminRule(CLAIM_ACTIONS.REQUEST_ORACLE);
  const manualReviewRule =
    statusName === "FRAUD_FLAGGED"
      ? { allowed: true, reason: "" }
      : getAdminRule(CLAIM_ACTIONS.MANUAL_REVIEW);
  const approveRule = getAdminRule(CLAIM_ACTIONS.APPROVE);
  const rejectRule = getAdminRule(CLAIM_ACTIONS.REJECT);
  const settleRule = getAdminRule(CLAIM_ACTIONS.SETTLE);
  const closeRule = getAdminRule(CLAIM_ACTIONS.CLOSE);
  const resolveTimeoutRule = getAdminRule(CLAIM_ACTIONS.RESOLVE_ORACLE_TIMEOUT, {
    oracleQuorumReached: true,
  });
  const canSettle = settleRule.allowed;
  const canShowVoting =
    statusName === "MANUAL_REVIEW" || statusName === "ORACLE_FAILED";
  const isAwaitingOracleQuorum =
    statusName === "ORACLE_PENDING" && !oracleQuorumStatus?.finalized;
  const canShowOracleResultPanel =
    statusName !== "ORACLE_PENDING" || oracleQuorumStatus?.finalized;

  async function refreshAll() {
    await refetch();
    await refetchOracle();
    await refetchReserve();
    await refetchAppeal();
    await refetchVotes();
    await refetchSettlementBreakdown();

    if (statusName === "ORACLE_PENDING") {
      await refetchOracleQuorumStatus();
    }
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
      setActionError(parseTransactionError(err));
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
      `Settle this claim now? This will transfer ${
        settlementBreakdown?.insurerPaysEth || "the calculated payout"
      } ETH from the contract reserve to the claimant.`
    );

    if (!confirmed) return;

    runAdminAction(() => settleClaim(id), "Claim settled successfully.");
  }

  function handleApproveHighValueSettlement() {
    runAdminAction(
      () => approveHighValueSettlement(id),
      "High-value settlement approved successfully."
    );
  }

  function handleResolveOracleTimeout() {
    runAdminAction(
      () => resolveOracleTimeout(id),
      "Timed-out oracle request resolved successfully."
    );
  }

  function handleClose() {
    const confirmed = window.confirm(
      "Close this claim lifecycle? Closed claims cannot return to an active workflow."
    );

    if (!confirmed) return;

    runAdminAction(() => closeClaim(id), "Claim closed successfully.");
  }

  function handleReviewAppeal(status) {
    if (!appeal?.id) return;

    runAdminAction(
      () =>
        reviewAppeal(appeal.id, {
          status,
          claimId: id,
          adminNote: appealAdminNote.trim(),
          auditorRecommendation: appealAuditorRecommendation.trim(),
          finalRejectionReason: appealFinalRejectionReason.trim(),
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

      {canSettle ? (
        <div className="card settlement-breakdown-card">
          <h3>On-Chain Settlement Breakdown</h3>

          {settlementLoading ? <p>Loading settlement formula...</p> : null}

          {settlementBreakdown ? (
            <>
              <div className="settlement-breakdown-grid">
                <div>
                  <span>Claim Amount</span>
                  <strong>{settlementBreakdown.claimAmountEth} ETH</strong>
                </div>
                <div>
                  <span>Deductible</span>
                  <strong>{settlementBreakdown.deductibleEth} ETH</strong>
                </div>
                <div>
                  <span>Insurer Pays</span>
                  <strong>{settlementBreakdown.insurerPaysEth} ETH</strong>
                </div>
                <div>
                  <span>Claimant Responsibility</span>
                  <strong>
                    {settlementBreakdown.claimantResponsibilityEth} ETH
                  </strong>
                </div>
              </div>

              <p className="muted-text">
                Formula: {settlementBreakdown.params.deductibleRatePercent} deductible
                capped at {settlementBreakdown.params.deductibleCapEth} ETH,
                then insurer pays {settlementBreakdown.params.insurerSharePercent}
                {" "}of the remaining amount.
              </p>

              <div className="settlement-breakdown-grid">
                <div>
                  <span>Reserve After Settlement</span>
                  <strong>{settlementBreakdown.reserveGate.reserveAfterEth} ETH</strong>
                </div>
                <div>
                  <span>Safe Threshold</span>
                  <strong>{settlementBreakdown.reserveGate.warningThresholdEth} ETH</strong>
                </div>
                <div>
                  <span>Reserve Ratio Gate</span>
                  <strong>
                    {settlementBreakdown.reserveGate.belowWarningThreshold
                      ? "Warning"
                      : "Pass"}
                  </strong>
                </div>
                <div>
                  <span>High-Value Control</span>
                  <strong>
                    {settlementBreakdown.reserveGate.highValueApprovalRequired
                      ? settlementBreakdown.reserveGate.highValueSettlementApproved
                        ? "Approved"
                        : "Approval Required"
                      : "Not Required"}
                  </strong>
                </div>
              </div>

              {settlementBreakdown.reserveGate.highValueApprovalRequired &&
              !settlementBreakdown.reserveGate.highValueSettlementApproved ? (
                <p className="error-text">
                  Direct settlement is blocked until one admin wallet records
                  high-value approval. A different on-chain admin wallet must
                  then execute settlement.
                </p>
              ) : null}

              {settlementBreakdown.reserveGate.highValueSettlementApproved ? (
                <p className="muted-text">
                  High-value approver:{" "}
                  {settlementBreakdown.reserveGate.highValueSettlementApprover}.
                  Settlement must be signed by a different admin address.
                </p>
              ) : null}

              {settlementBreakdown.reserveGate.belowWarningThreshold ? (
                <p className="error-text">
                  Reserve warning: this payout would leave the reserve below the
                  configured threshold. This is advisory unless the contract gate
                  rejects the transaction for another reason.
                </p>
              ) : null}
            </>
          ) : null}
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
            disabled={!requestOracleRule.allowed || isActing}
            title={requestOracleRule.reason}
          >
            Request Oracle Verification
          </button>

          <button
            type="button"
            onClick={handleManualReview}
            disabled={!manualReviewRule.allowed || isActing}
            title={manualReviewRule.reason}
          >
            Send to Manual Review
          </button>

          <button
            type="button"
            onClick={handleResolveOracleTimeout}
            disabled={!resolveTimeoutRule.allowed || isActing}
            title={resolveTimeoutRule.reason}
          >
            Resolve Oracle Timeout
          </button>

          <button
            type="button"
            onClick={handleApprove}
            disabled={!approveRule.allowed || isActing}
            title={approveRule.reason}
          >
            Approve Claim
          </button>

          <button
            type="button"
            onClick={handleApproveHighValueSettlement}
            disabled={
              isActing ||
              !settleRule.allowed ||
              !settlementBreakdown?.reserveGate?.highValueApprovalRequired ||
              settlementBreakdown?.reserveGate?.highValueSettlementApproved
            }
            title={
              settlementBreakdown?.reserveGate?.highValueApprovalRequired
                ? ""
                : "Settlement is below high-value threshold"
            }
          >
            Approve High-Value Settlement
          </button>

          <button
            type="button"
            onClick={handleSettle}
            disabled={
              !settleRule.allowed ||
              isActing ||
              (settlementBreakdown?.reserveGate?.highValueApprovalRequired &&
                !settlementBreakdown?.reserveGate?.highValueSettlementApproved)
            }
            title={
              settlementBreakdown?.reserveGate?.highValueApprovalRequired &&
              !settlementBreakdown?.reserveGate?.highValueSettlementApproved
                ? "High-value approval required"
                : settleRule.reason
            }
          >
            Settle Claim
          </button>

          <button
            type="button"
            onClick={handleClose}
            disabled={!closeRule.allowed || isActing}
            title={closeRule.reason}
          >
            Close Claim
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
            disabled={!rejectRule.allowed || isActing}
            title={rejectRule.reason}
          >
            Reject Claim
          </button>
        </div>
      </div>

      {statusName === "ORACLE_PENDING" ? (
        <div className="card oracle-quorum-card">
          <h3>Oracle Quorum</h3>

          {quorumLoading ? <p>Loading oracle confirmations...</p> : null}

          {oracleQuorumStatus ? (
            <>
              <p>
                Oracle Confirmations:{" "}
                <strong>
                  {oracleQuorumStatus.confirmations} / {oracleQuorumStatus.required} required
                </strong>
              </p>

              <div
                className="oracle-confirmation-dots"
                aria-label={`${oracleQuorumStatus.confirmations} of ${oracleQuorumStatus.required} oracle confirmations`}
              >
                {Array.from({ length: oracleQuorumStatus.required || 0 }).map((_, index) => (
                  <span
                    className={
                      index < oracleQuorumStatus.confirmations ? "is-filled" : ""
                    }
                    key={`oracle-confirmation-${index}`}
                  />
                ))}
              </div>

              <p className={oracleQuorumStatus.finalized ? "success-text" : "muted-text"}>
                {oracleQuorumStatus.finalized
                  ? "Oracle quorum reached."
                  : "Awaiting additional oracle confirmation."}
              </p>
            </>
          ) : null}
        </div>
      ) : null}

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
            <p>Appeal deadline: {formatValue(appeal.appealDeadline)}</p>
            <p>Category: {formatValue(appeal.reasonCategory)}</p>
            <p>Claimant: {formatValue(appeal.claimantWallet)}</p>
            <p>Reason: {formatValue(appeal.appealReason)}</p>
            <p>Description: {formatValue(appeal.appealDescription)}</p>
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
              <label>
                Auditor recommendation
                <input
                  type="text"
                  value={appealAuditorRecommendation}
                  onChange={(event) => setAppealAuditorRecommendation(event.target.value)}
                  placeholder={appeal.auditorRecommendation || "Optional recommendation summary"}
                />
              </label>
              <label>
                Final rejection reason
                <input
                  type="text"
                  value={appealFinalRejectionReason}
                  onChange={(event) => setAppealFinalRejectionReason(event.target.value)}
                  placeholder={appeal.finalRejectionReason || "Required when rejecting final appeal"}
                />
              </label>
            </div>

            <div className="action-row">
              <button
                type="button"
                onClick={() => handleReviewAppeal("UNDER_REVIEW")}
                disabled={isActing || appealIsFinal || appeal.status === "UNDER_REVIEW"}
              >
                Mark Under Review
              </button>
              <button
                type="button"
                onClick={() => handleReviewAppeal("APPROVED")}
                disabled={isActing || appealIsFinal}
              >
                Approve Appeal
              </button>
              <button
                type="button"
                onClick={() => handleReviewAppeal("REJECTED")}
                disabled={isActing || appealIsFinal}
              >
                Reject Appeal
              </button>
            </div>
          </>
        ) : null}

        {appeal?.history?.length ? (
          <div>
            <h4>Appeal History</h4>
            {appeal.history.map((entry, index) => (
              <p key={`${entry.status}-${entry.timestamp || index}`}>
                {formatValue(entry.timestamp)} - {formatValue(entry.status)} by{" "}
                {formatValue(entry.actorRole)} {entry.note ? `- ${entry.note}` : ""}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      <h3>Oracle Results</h3>

      {oracleLoading ? <p>Loading oracle logs...</p> : null}

      {isAwaitingOracleQuorum ? (
        <p className="muted-text">
          Awaiting additional oracle confirmation before the final oracle result is shown.
        </p>
      ) : null}

      {canShowOracleResultPanel && !oracleLoading ? (
        <OracleComparisonPanel
          logs={oracleLogs}
          quorumSummary={backendQuorumSummary || oracleQuorumStatus}
        />
      ) : null}
    </section>
  );
}
