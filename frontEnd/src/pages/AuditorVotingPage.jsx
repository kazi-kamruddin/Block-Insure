import InsurerClaimStatement from "../components/InsurerClaimStatement";
import { Contract } from "ethers";
import { api } from "../services/api";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import ClaimStatusBadge from "../components/ClaimStatusBadge";
import EvidenceField from "../components/EvidenceField";
import EvidenceChainPanel from "../components/EvidenceChainPanel";
import ReviewAccessPanel from "../components/ReviewAccessPanel";
import OracleComparisonPanel from "../components/OracleComparisonPanel";
import PolicyEligibilityResult from "../components/PolicyEligibilityResult";
import TransactionLink from "../components/TransactionLink";
import {
  getClaimById,
  getClaimVoteSummary,
  getOracleResults,
  getReviewAccess,
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
  if (log?.responseData?.assessment?.model === "XGBoost") {
    const score = log.responseData.assessment.score;
    return Number.isFinite(score) ? Math.round(score * 100) : null;
  }
  return (
    log?.responseData?.hospitalVerification?.riskAssessment?.fraudProbabilityPercent ??
    log?.hospitalVerification?.riskAssessment?.fraudProbabilityPercent ??
    log?.responseData?.riskAssessment?.fraudProbabilityPercent ??
    log?.riskAssessment?.fraudProbabilityPercent ??
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
  const [basis, setBasis] = useState("");
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
  const accessQuery = useQuery({ queryKey: ["reviewAccess", claimId, walletAddress], queryFn: () => getReviewAccess(claimId), refetchInterval: 10_000, refetchIntervalInBackground: false, retry: false, enabled: Boolean(claimId) });
  const bayesianFraudPercent = getBayesianFraudPercent(latestOracleLog);
  const voteRule = getClaimActionRule({
    action: CLAIM_ACTIONS.AUDITOR_VOTE,
    statusName,
    role: "AUDITOR",
    hasVoted: Boolean(voteSummary?.hasCurrentUserVoted),
    auditorVotingFinalized: Boolean(voteSummary?.finalized),
  });
  const isReviewable = voteRule.allowed || voteRule.reason === "Already voted";
  const canVote = voteRule.allowed && voteSummary && !isVoting && accessQuery.data?.preparation?.state === "ACTIVE";

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
      let tx;
      if (voteSummary.reasonedVoting) {
        const version = voteSummary.version;
        const { data } = await api.post(`/api/votes/claim/${claimId}/reason`, { vote: voteCode, basis, version });
        const adjudicator = new Contract(await contract.claimAdjudicator(), ["function castReasonedVote(uint256,uint64,uint8,bytes32)"], contract.runner);
        tx = await adjudicator.castReasonedVote(claimId, version, voteCode, data.commitment);
      } else tx = await contract.castVote(claimId, voteCode);

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
      <div className="page-header-row">
        <div>
          <span className="section-eyebrow">Quorum adjudication</span>
          <h1>Auditor Vote</h1>
        </div>
        <div className="action-row">
          <Link to="/auditor/votes" className="button-link button-secondary">
            Back to voting queue
          </Link>
          <button type="button" className="button-secondary" onClick={refreshAll}>
            Refresh Voting Data
          </button>
        </div>
      </div>

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
      <InsurerClaimStatement statement={claimData?.insurerStatement} />
      {claim && <><ReviewAccessPanel claimId={claimId} onChange={refreshAll} /><EvidenceChainPanel evidenceChain={claimData?.evidenceChain} /></>}
      {claim ? (
        <div className="card">
          <h3>Claim #{formatValue(claim.claimId || claimId)}</h3>
          <dl className="detail-kv-grid">
            <div>
              <dt>Type</dt>
              <dd>{formatValue(claim.claimType)}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd>{formatValue(claim.claimAmountEth || claim.claimAmount)} ETH</dd>
            </div>
            <div>
              <dt>Hospital</dt>
              <dd>{formatValue(claim.hospitalId)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd><ClaimStatusBadge status={statusName} /></dd>
            </div>
            <div>
              <dt>Verification confidence</dt>
              <dd>{formatValue(claim.verificationConfidence)}/100</dd>
            </div>
            <div>
              <dt>Recorded model risk score</dt>
              <dd>
                {bayesianFraudPercent === null
                  ? "-"
                  : `${formatValue(bayesianFraudPercent)}%`}
              </dd>
            </div>
          </dl>
          <PolicyEligibilityResult
            evaluation={claim.policyEligibility?.evaluation}
            title="Submission-time policy assessment"
          />
          <EvidenceField label="Invoice hash" value={claim.invoiceHash} />
          <EvidenceField label="Document hash" value={claim.documentHash} />
        </div>
      ) : null}

      <div className={`card voting-readiness ${canVote ? "is-open" : ""}`}>
        <h3>Voting Readiness</h3>
        <p>
          {voteRule.allowed && accessQuery.data?.preparation?.state !== "ACTIVE"
            ? "Voting waits for activation of the assigned reviewers' access to the sealed evidence set. See evidence preparation above."
            : voteRule.reason ||
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
        <h3>Advisory weighted summary</h3>
        <p>Weights do not decide claims. Exactly four assigned auditors vote: three approvals approve; two rejections reject. Insufficient quorum at expiry rejects.</p>
        {voteSummary?.reasonedVoting && !voteSummary.hasCurrentUserVoted && !voteSummary.finalized && (
          <label>
            Evidence supporting your vote
            <textarea
              rows={3}
              maxLength={500}
              value={basis}
              onChange={(event) => setBasis(event.target.value)}
              placeholder="Summarize key invoice, hospital, or medical evidence facts..."
            />
            <small>{basis.length}/500 characters</small>
          </label>
        )}
        {voteSummary?.voters?.filter(voter => voter.rationale).map(voter =>
          <p key={voter.auditorAddress}>{voter.shortenedAddress}: {voter.rationale}</p>)}
        {voteLoading ? <p>Loading votes...</p> : null}

        {voteSummary?.peerVotesHidden && <p>Peer votes appear here after you vote or the review closes. Votes are visible on the public chain.</p>}
        {voteSummary && !voteSummary.peerVotesHidden ? (
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
        <p className="muted-text">
          Casting a vote opens MetaMask and commits your signed decision on-chain.
        </p>

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
