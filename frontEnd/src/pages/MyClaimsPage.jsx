import { Link } from "react-router-dom";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import ClaimStatusBadge from "../components/ClaimStatusBadge";
import PaginationControls from "../components/PaginationControls";
import { getMyClaims } from "../services/api";
import { useWallet } from "../context/useWallet";
import {
  getClaimStatusName,
  getStatusExplanation,
} from "../utils/claimStatus";
import "../styles/pages/MyClaimsPage.css";

function extractClaims(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.claims)) return data.claims;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

export default function MyClaimsPage() {
  const { isConnected, walletAddress } = useWallet();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [searchTerm, setSearchTerm] = useState("");

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["myClaims", walletAddress, page],
    queryFn: () => getMyClaims({ page }),
    enabled: isConnected,
  });

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const claims = [...extractClaims(data)].reverse().filter((claim) => {
    const matchesStatus =
      statusFilter === "ALL" || getClaimStatusName(claim) === statusFilter;
    const searchable = [
      claim.claimId,
      claim.displayTitle,
      claim.policyPackageName,
      claim.claimType,
      claim.hospitalId,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return matchesStatus && (!normalizedSearch || searchable.includes(normalizedSearch));
  });

  return (
    <section className="page-container page-my-claims">
      <h2>My Claims</h2>

      <button
        type="button"
        onClick={() => refetch()}
        disabled={!isConnected || isFetching}
      >
        {isFetching ? "Refreshing..." : "Refresh My Claims"}
      </button>
      <div className="list-toolbar" role="search">
        <label className="compact-filter">
          Search claims
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Claim, package, hospital..."
          />
        </label>
        <label className="compact-filter">
          Show
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="ALL">All claims</option>
            <option value="DUPLICATE_CHECKED">Duplicate checks passed</option>
            <option value="FRAUD_FLAGGED">Flagged</option>
            <option value="ORACLE_PENDING">Oracle pending</option>
            <option value="ORACLE_VERIFIED">Oracle verified</option>
            <option value="ORACLE_FAILED">Oracle failed</option>
            <option value="MANUAL_REVIEW">Manual review</option>
            <option value="PAYOUT_READY">Payout ready</option>
            <option value="FUNDING_REQUIRED">Funding required</option>
            <option value="REJECTED">Rejected</option>
            <option value="SETTLED">Settled</option>
            <option value="CLOSED">Closed</option>
          </select>
        </label>
      </div>

      {error ? (
        <p className="error-text">
          {error.message || "Could not load your claims"}
        </p>
      ) : null}

      {isLoading ? <p>Loading claims...</p> : null}

      {!isLoading && !error && claims.length === 0 ? (
        <div className="card empty-state">
          <span className="dashboard-eyebrow">Clean claim history</span>
          <h3>No claims submitted yet</h3>
          <p>
            Your first claim will appear here after it is committed on-chain.
            You need an active policy before submitting.
          </p>
          <div className="action-row">
            <Link to="/user/claims/new">Submit a Claim</Link>
            <Link to="/user/policies">Check My Policies</Link>
          </div>
        </div>
      ) : null}

      <div className="card-row">
        {claims.map((claim) => (
          <article className="card claim-summary-card" key={claim.claimId}>
            <div className="claim-card-heading">
              <div>
                <span className="dashboard-eyebrow">Claim #{claim.claimId}</span>
                <h3>{claim.displayTitle || `${claim.claimType} claim`}</h3>
                <p>{claim.policyPackageName || `Policy #${claim.policyId}`}</p>
              </div>
              <ClaimStatusBadge status={getClaimStatusName(claim)} showHelp />
            </div>
            <div className="claim-card-metrics">
              <span><strong>{claim.claimAmountEth || claim.claimAmount} ETH</strong> claimed</span>
              <span><strong>{claim.hospitalId}</strong> provider</span>
              <span>
                <strong>
                  {claim.riskScoreAvailable === false
                    ? "Not calculated"
                    : `${claim.riskScore ?? "-"}/100`}
                </strong>{" "}
                validation score
              </span>
            </div>
            <p className="claim-next-step">
              {claim.fraudReason
                ? `Screening reason: ${claim.fraudReason}. `
                : ""}
              {getStatusExplanation(getClaimStatusName(claim))}
            </p>
            <Link className="primary-link-button" to={`/user/claims/${claim.claimId}`}>
              Open Claim
            </Link>
          </article>
        ))}
      </div>
      <PaginationControls
        pagination={data?.pagination}
        onPageChange={setPage}
      />
    </section>
  );
}
