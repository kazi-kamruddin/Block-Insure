import { Link } from "react-router-dom";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import ClaimStatusBadge from "../components/ClaimStatusBadge";
import PaginationControls from "../components/PaginationControls";
import { getAdminClaims } from "../services/api";
import "../styles/pages/AdminClaimListPage.css";
import { getClaimStatusName, getStatusExplanation } from "../utils/claimStatus";

function extractClaims(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.claims)) return data.claims;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

export default function AdminClaimListPage() {
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
    queryKey: ["adminClaims", page],
    queryFn: () => getAdminClaims({ page }),
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
      claim.claimantWallet,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return matchesStatus && (!normalizedSearch || searchable.includes(normalizedSearch));
  });

  return (
    <section className="page-container page-admin-claim-list">
      <h2>Admin Claims</h2>

      <button type="button" onClick={() => refetch()} disabled={isFetching}>
        {isFetching ? "Refreshing..." : "Refresh Claims"}
      </button>
      <div className="list-toolbar" role="search">
        <label className="compact-filter">
          Search queue
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Claim, wallet, package..."
          />
        </label>
        <label className="compact-filter">
          Queue
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="ALL">All claims</option>
            <option value="DUPLICATE_CHECKED">Ready for oracle</option>
            <option value="ORACLE_PENDING">Oracle pending</option>
            <option value="ORACLE_VERIFIED">Ready for decision</option>
            <option value="ORACLE_FAILED">Oracle failed</option>
            <option value="FRAUD_FLAGGED">Fraud flagged</option>
            <option value="MANUAL_REVIEW">Manual review</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="SETTLED">Settled</option>
            <option value="CLOSED">Closed</option>
          </select>
        </label>
      </div>

      {error ? (
        <p className="error-text">
          {error.message || "Could not load admin claims"}
        </p>
      ) : null}

      {isLoading ? <p>Loading claims...</p> : null}

      {!isLoading && !error && claims.length === 0 ? (
        <div className="card empty-state">
          <span className="dashboard-eyebrow">Clean operational state</span>
          <h3>No claims require review</h3>
          <p>
            Claims will appear here after a policyholder submits one. Nothing
            has been pre-populated into this queue.
          </p>
          <Link to="/admin/dashboard">Return to Portfolio Overview</Link>
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
              <ClaimStatusBadge
                status={
                  claim.statusLabel ||
                  claim.statusName ||
                  claim.statusCode ||
                  claim.status
                }
              />
            </div>
            <div className="claim-card-metrics">
              <span><strong>{claim.claimAmountEth || claim.claimAmount} ETH</strong> claimed</span>
              <span><strong>{claim.hospitalId}</strong> provider</span>
              <span><strong>{claim.claimantWallet.slice(0, 6)}…{claim.claimantWallet.slice(-4)}</strong> claimant</span>
            </div>
            <p className="claim-next-step">
              {claim.fraudReason ? `${claim.fraudReason}. ` : ""}
              {getStatusExplanation(getClaimStatusName(claim))}
            </p>
            <Link className="primary-link-button" to={`/admin/claims/${claim.claimId}`}>
              Review Claim
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
