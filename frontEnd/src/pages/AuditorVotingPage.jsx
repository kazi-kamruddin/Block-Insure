import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import ClaimStatusBadge from "../components/ClaimStatusBadge";
import EvidenceField from "../components/EvidenceField";
import OracleComparisonPanel from "../components/OracleComparisonPanel";
import TransactionLink from "../components/TransactionLink";
import {
  getClaimById,
  getClaimVoteSummary,
  getOracleResults,
} from "../services/api";
import { getWalletContract } from "../services/contractService";
import { getClaimStatusName } from "../utils/claimStatus";
import "../styles/pages/AuditorVotingPage.css";

const VOTE_OPTIONS = [
  { code: 1, label: "Valid Claim", tone: "valid" },
  { code: 2, label: "Invalid Claim", tone: "invalid" },
  { code: 3, label: "Needs More Evidence", tone: "needs-more" },
];

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

function extractVoteSummary(data) {
  return data?.voteSummary || data?.data?.voteSummary || null;
}

function formatValue(value) {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatPercent(value) {
  const numericValue = Number(value || 0);
  return `${Math.round(numericValue * 100)}%`;
}

function getLatestOracleLog(logs) {
  return logs[0] || null;
}

export default function AuditorVotingPage() {
  const { claimId } = useParams();
  const [voteError, setVoteError] = useState("");
  const [voteMessage, setVoteMessage] = useState("");
  const [voteTxHash, setVoteTxHash] = useState("");
  const [isVoting, setIsVoting] = useState(false);

  const {
    data: claimData,
    isLoading: claimLoading,
    error: claimError,
    refetch: refetchClaim,
  } = useQuery({
    queryKey: ["auditorVotingClaim", claimId],
    queryFn: () => getClaimById(claimId),
    enabled: Boolean(claimId),
  });

  const {
    data: oracleData,
    isLoading: oracleLoading,
    refetch: refetchOracle,
  } = useQuery({
    queryKey: ["auditorVotingOracle", claimId],
    queryFn: () => getOracleResults(claimId),
    enabled: Boolean(claimId),
  });

  const {
    data: voteData,
    isLoading: voteLoading,
    refetch: refetchVotes,
  } = useQuery({
    queryKey: ["auditorVoteSummary", claimId],
    queryFn: () => getClaimVoteSummary(claimId),
    enabled: Boolean(claimId),
  });

  const claim = extractClaim(claimData);
  const statusName = getClaimStatusName(claim);
  const oracleLogs = extractOracleLogs(oracleData);
  const latestOracleLog = getLatestOracleLog(oracleLogs);
  const voteSummary = extractVoteSummary(voteData);
  const isReviewable =
    statusName === "MANUAL_REVIEW" || statusName === "ORACLE_FAILED";
  const canVote =
    isReviewable && voteSummary && !voteSummary.hasCurrentUserVoted && !isVoting;

  async function refreshAll() {
    await refetchClaim();
    await refetchOracle();
    await refetchVotes();
  }

  async function handleCastVote(voteCode) {
    setVoteError("");
    setVoteMessage("");
    setVoteTxHash("");

    try {
      setIsVoting(true);

      const contract = await getWalletContract();
      const tx = await contract.castVote(claimId, voteCode);

      setVoteTxHash(tx.hash);

      await tx.wait();
      setVoteMessage("Vote recorded on-chain.");
      await refreshAll();
    } catch (error) {
      console.error(error);
      setVoteError(
        error.reason ||
          error.shortMessage ||
          error.response?.data?.message ||
          error.message ||
          "Vote transaction failed"
      );
    } finally {
      setIsVoting(false);
    }
  }

  return (
    <section className="page-container page-auditor-voting">
      <h2>Auditor Vote</h2>

      <p>
        <Link to="/auditor/claims">Back to claim lookup</Link>
      </p>

      <button type="button" onClick={refreshAll}>
        Refresh Voting Data
      </button>

      {claimLoading ? <p>Loading claim...</p> : null}

      {claimError ? (
        <p className="error-text">
          {claimError.response?.data?.message ||
            claimError.message ||
            "Could not load claim"}
        </p>
      ) : null}

      {voteError ? <p className="error-text">{voteError}</p> : null}
      {voteMessage ? <p className="success-text">{voteMessage}</p> : null}
      {voteTxHash ? (
        <p>
          Vote transaction: <TransactionLink txHash={voteTxHash} />
        </p>
      ) : null}

      {claim ? (
        <div className="card">
          <h3>Claim #{formatValue(claim.claimId || claimId)}</h3>
          <div className="voting-detail-grid">
            <p>Type: {formatValue(claim.claimType)}</p>
            <p>Amount: {formatValue(claim.claimAmountEth || claim.claimAmount)} ETH</p>
            <p>Hospital: {formatValue(claim.hospitalId)}</p>
            <p>
              Status: <ClaimStatusBadge status={statusName} />
            </p>
            <p>Bayesian risk score: {formatValue(claim.riskScore)}</p>
          </div>
          <EvidenceField label="Invoice hash" value={claim.invoiceHash} />
          <EvidenceField label="Document hash" value={claim.documentHash} />
        </div>
      ) : null}

      <div className="card">
        <h3>Oracle Result Summary</h3>
        {oracleLoading ? <p>Loading oracle results...</p> : null}
        {!oracleLoading && !latestOracleLog ? <p>No oracle result found.</p> : null}
        {latestOracleLog ? (
          <>
            <div className="voting-detail-grid">
              <p>Request ID: {formatValue(latestOracleLog.requestId)}</p>
              <p>Verified: {formatValue(latestOracleLog.verified)}</p>
              <p>Risk level: {formatValue(latestOracleLog.riskLevel)}</p>
              <p>
                Transaction:{" "}
                <TransactionLink
                  txHash={latestOracleLog.submittedTxHash || latestOracleLog.txHash}
                />
              </p>
            </div>
            <OracleComparisonPanel log={latestOracleLog} />
          </>
        ) : null}
      </div>

      <div className="card">
        <h3>Weighted Consensus</h3>
        {voteLoading ? <p>Loading votes...</p> : null}

        {voteSummary ? (
          <>
            <div className="vote-breakdown-grid">
              {Object.values(voteSummary.breakdown || {}).map((entry) => (
                <div className="vote-breakdown-item" key={entry.label}>
                  <strong>{entry.displayLabel}</strong>
                  <span>{entry.count} votes</span>
                  <span>Weight {entry.weightedSum}</span>
                </div>
              ))}
            </div>

            <div className="consensus-strip">
              <span>
                Consensus:{" "}
                <strong>{voteSummary.consensusDisplayLabel || "No Consensus"}</strong>
              </span>
              <span>
                Strength: <strong>{formatPercent(voteSummary.consensusStrength)}</strong>
              </span>
              <span>
                Total voters: <strong>{voteSummary.totalVoters || 0}</strong>
              </span>
            </div>

            {voteSummary.hasCurrentUserVoted ? (
              <p className="success-text">
                Your vote: {voteSummary.currentUserVote?.voteDisplayLabel}
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="card voting-panel">
        <h3>Cast Vote</h3>

        <div className="action-row vote-action-row">
          {VOTE_OPTIONS.map((option) => (
            <button
              className={`vote-button vote-${option.tone}`}
              type="button"
              key={option.code}
              onClick={() => handleCastVote(option.code)}
              disabled={!canVote}
            >
              {option.label}
            </button>
          ))}
        </div>

        {!isReviewable ? (
          <p className="muted-text">
            Current status {statusName} is not open for auditor voting.
          </p>
        ) : null}
      </div>
    </section>
  );
}
