import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import ClaimStatusBadge from "../components/ClaimStatusBadge";
import {
  getAllReadableClaims,
  getClaimVoteSummary,
} from "../services/api";
import { useWallet } from "../context/useWallet";
import { getClaimStatusName, getStatusExplanation } from "../utils/claimStatus";
import "../styles/pages/AuditorClaimLookupPage.css";

const VOTE_OPEN_STATUSES = new Set(["MANUAL_REVIEW", "ORACLE_FAILED"]);

function extractClaims(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.claims)) return data.claims;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function shortenAddress(address) {
  if (!address) return "-";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

async function getActiveWalletAddress(fallbackWallet) {
  try {
    const accounts = await window.ethereum?.request({ method: "eth_accounts" });
    return (accounts?.[0] || fallbackWallet || "").toLowerCase();
  } catch {
    return (fallbackWallet || "").toLowerCase();
  }
}

async function loadVoteQueue(fallbackWallet) {
  const activeWalletAddress = await getActiveWalletAddress(fallbackWallet);
  const claimsData = await getAllReadableClaims({ limit: 100 });
  const claims = extractClaims(claimsData).filter((claim) =>
    VOTE_OPEN_STATUSES.has(getClaimStatusName(claim))
  );

  const enrichedClaims = await Promise.all(
    claims.map(async (claim) => {
      try {
        const voteData = await getClaimVoteSummary(
          claim.claimId,
          activeWalletAddress
        );
        const voteSummary = voteData?.voteSummary || voteData?.data?.voteSummary;

        return {
          ...claim,
          voteSummary,
          hasCurrentUserVoted: Boolean(voteSummary?.hasCurrentUserVoted),
        };
      } catch (error) {
        return {
          ...claim,
          voteSummaryError:
            error.response?.data?.message ||
            error.message ||
            "Could not load vote summary",
        };
      }
    })
  );

  return enrichedClaims.filter((claim) => !claim.hasCurrentUserVoted);
}

export default function AuditorVoteQueuePage() {
  const { walletAddress } = useWallet();
  const {
    data: claims = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["auditorVoteQueue", walletAddress],
    queryFn: () => loadVoteQueue(walletAddress),
  });

  return (
    <section className="page-container page-auditor-claim-lookup">
      <div className="page-heading-row">
        <div>
          <h2>Voting Queue</h2>
          <p>
            Auditors vote only when a claim is actually open for independent
            review. In this contract, that means claims in{" "}
            <strong>MANUAL_REVIEW</strong> or <strong>ORACLE_FAILED</strong>.
          </p>
        </div>
        <button type="button" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Refreshing..." : "Refresh Queue"}
        </button>
      </div>

      {error ? (
        <p className="error-text">
          {error.response?.data?.message ||
            error.message ||
            "Could not load vote queue"}
        </p>
      ) : null}

      {isLoading ? <p>Loading vote-eligible claims...</p> : null}

      {!isLoading && claims.length === 0 ? (
        <div className="card auditor-empty-state">
          <h3>No vote-ready claims</h3>
          <p>
            There are no manual-review or oracle-failed claims waiting for your
            auditor wallet right now, or your wallet has already voted on the
            currently open ones.
          </p>
          <Link to="/auditor/claims">View all claim timelines</Link>
        </div>
      ) : null}

      {claims.length > 0 ? (
        <div className="auditor-claim-list">
          {claims.map((claim) => {
            const statusName = getClaimStatusName(claim);
            const voteSummary = claim.voteSummary;

            return (
              <article className="card auditor-claim-card" key={claim.claimId}>
                <div>
                  <span className="claim-card-eyebrow">Claim #{claim.claimId}</span>
                  <h3>{claim.claimType || "Healthcare claim"}</h3>
                  <p>{getStatusExplanation(statusName)}</p>
                </div>

                <div className="auditor-claim-meta">
                  <span>
                    Status <ClaimStatusBadge status={statusName} />
                  </span>
                  <span>Amount {claim.claimAmountEth || claim.claimAmount} ETH</span>
                  <span>Hospital {claim.hospitalId || "-"}</span>
                  <span>Claimant {shortenAddress(claim.claimantWallet)}</span>
                  <span>
                    Current voters {voteSummary?.totalVoters ?? "unknown"}
                  </span>
                  <span>
                    Consensus {voteSummary?.consensusDisplayLabel || "No Consensus"}
                  </span>
                </div>

                {claim.voteSummaryError ? (
                  <p className="error-text">{claim.voteSummaryError}</p>
                ) : null}

                <div className="action-row">
                  <Link to={`/auditor/vote/${claim.claimId}`}>Open Voting Review</Link>
                  <Link to={`/auditor/claims/${claim.claimId}/history`}>
                    View Timeline
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
