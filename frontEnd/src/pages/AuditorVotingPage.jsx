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
import { useWallet } from "../context/useWallet";
import { getWalletContract, parseTransactionError } from "../services/contractService";
import { CLAIM_ACTIONS, getClaimActionRule } from "../services/claimActionRules";
import { getClaimStatusName } from "../utils/claimStatus";
import "../styles/pages/AuditorVotingPage.css";
import { showToast } from "../services/toast";

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

function getBayesianFraudPercent(log) {
  return (
    log?.responseData?.hospitalVerification?.riskAssessment?.posteriorFraudPercent ??
    log?.hospitalVerification?.riskAssessment?.posteriorFraudPercent ??
    log?.responseData?.riskAssessment?.posteriorFraudPercent ??
    log?.riskAssessment?.posteriorFraudPercent ??
    null
  );
}

function getVotingHint({ isReviewable, statusName, voteSummary, isVoting }) {
  if (isVoting) return "Waiting for the vote transaction to confirm.";
  if (!isReviewable) {
    return `Current status ${statusName} is not open for auditor voting.`;
  }
  if (voteSummary?.hasCurrentUserVoted) {
    return "Your wallet has already voted on this claim.";
  }
  return "This claim is open for auditor voting.";
}

async function getActiveWalletAddress(fallbackWallet) {
  try {
    const accounts = await window.ethereum?.request({ method: "eth_accounts" });
    return (accounts?.[0] || fallbackWallet || "").toLowerCase();
  } catch {
    return (fallbackWallet || "").toLowerCase();
  }
}

export default function AuditorVotingPage() {
  const { claimId } = useParams();
  const { walletAddress } = useWallet();
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
    queryKey: ["auditorVoteSummary", claimId, walletAddress],
    queryFn: async () => {
      const activeWalletAddress = await getActiveWalletAddress(walletAddress);
      return getClaimVoteSummary(claimId, activeWalletAddress);
    },
    enabled: Boolean(claimId),
  });

  const claim = extractClaim(claimData);
  const statusName = getClaimStatusName(claim);
  const oracleLogs = extractOracleLogs(oracleData);
  const backendQuorumSummary = oracleData?.quorumSummary || oracleData?.data?.quorumSummary;
  const latestOracleLog = getLatestOracleLog(oracleLogs);
  const voteSummary = extractVoteSummary(voteData);
  const bayesianFraudPercent = getBayesianFraudPercent(latestOracleLog);
  const voteRule = getClaimActionRule({
    action: CLAIM_ACTIONS.AUDITOR_VOTE,
    statusName,
    role: "AUDITOR",
    hasVoted: Boolean(voteSummary?.hasCurrentUserVoted),
    auditorVotingFinalized: Boolean(voteSummary?.finalized),
  });
  const isReviewable = voteRule.allowed || voteRule.reason === "Already voted";
  const canVote = voteRule.allowed && voteSummary && !isVoting;

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
      const label =
        VOTE_OPTIONS.find((option) => option.code === voteCode)?.label ||
        "Auditor";
      setVoteMessage(`${label} vote recorded on-chain.`);
      showToast(`${label} vote recorded for claim #${claimId}.`, {
        title: "Auditor vote confirmed",
      });
      await refreshAll();
    } catch (error) {
      console.error(error);
      const message = parseTransactionError(error);
      setVoteError(message);
      showToast(message, { tone: "error", title: "Vote failed" });
    } finally {
      setIsVoting(false);
    }
  }

  return (
    <section className="page-container page-auditor-voting">
      <h2>Auditor Vote</h2>

      <p>
        <Link to="/auditor/votes">Back to voting queue</Link>
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

      <div className="auditor-vote-workspace">
        <div className="auditor-vote-analysis">
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
            <p>
              On-chain validation score: {formatValue(claim.riskScore)}/100
              <small> Higher means the deterministic submission checks passed.</small>
            </p>
            <p>
              Bayesian fraud probability:{" "}
              {bayesianFraudPercent === null
                ? "-"
                : `${formatValue(bayesianFraudPercent)}%`}
            </p>
          </div>
          <EvidenceField label="Invoice hash" value={claim.invoiceHash} />
          <EvidenceField label="Document hash" value={claim.documentHash} />
        </div>
      ) : null}

      <div className={`card voting-readiness ${canVote ? "is-open" : ""}`}>
        <h3>Voting Readiness</h3>
        <p>
          {voteRule.reason ||
            getVotingHint({ isReviewable, statusName, voteSummary, isVoting })}
        </p>
      </div>

      <div className="card">
        <h3>Oracle Result Summary</h3>
        {oracleLoading ? <p>Loading oracle results...</p> : null}
        {!oracleLoading ? (
          <OracleComparisonPanel
            logs={oracleLogs}
            quorumSummary={backendQuorumSummary}
          />
        ) : null}
      </div>

        </div>
        <aside className="auditor-vote-decision">
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
                  <b
                    className="vote-weight-bar"
                    style={{
                      width: `${
                        voteSummary.totalWeight
                          ? (entry.weightedSum / voteSummary.totalWeight) * 100
                          : 0
                      }%`,
                    }}
                  />
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
                Quorum:{" "}
                <strong>
                  {voteSummary.totalVoters || 0}/{voteSummary.minimumVoters || 2}
                </strong>
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
              className={`vote-button vote-${option.tone} ${
                voteSummary?.currentUserVote?.vote === option.code
                  ? "is-selected"
                  : ""
              }`}
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
            {voteRule.reason || `Current status ${statusName} is not open for auditor voting.`}
          </p>
        ) : null}
      </div>
        </aside>
      </div>
    </section>
  );
}
