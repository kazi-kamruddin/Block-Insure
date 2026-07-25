import { Link } from "react-router-dom";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import ClaimStatusBadge from "../components/ClaimStatusBadge";
import PaginationControls from "../components/PaginationControls";
import { getAdminClaims } from "../services/api";
import "../styles/pages/AdminClaimListPage.css";

function extractClaims(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.claims)) return data.claims;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

export default function AdminClaimListPage() {
  const [page, setPage] = useState(1);
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

  const claims = extractClaims(data);

  return (
    <section className="page-container page-admin-claim-list">
      <h2>Admin Claims</h2>

      <button type="button" onClick={() => refetch()} disabled={isFetching}>
        {isFetching ? "Refreshing..." : "Refresh Claims"}
      </button>

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
          <div className="card" key={claim.claimId}>
            <h3>Claim #{claim.claimId}</h3>

            <p>Policy ID: {claim.policyId}</p>
            <p>Claimant: {claim.claimantWallet}</p>
            <p>Amount: {claim.claimAmountEth || claim.claimAmount} ETH</p>
            <p>Claim type: {claim.claimType}</p>
            <p>Hospital ID: {claim.hospitalId}</p>
            <p>
              Status:{" "}
              <ClaimStatusBadge
                status={
                  claim.statusLabel ||
                  claim.statusName ||
                  claim.statusCode ||
                  claim.status
                }
              />
            </p>
            <p>Risk score: {claim.riskScore ?? "-"}</p>

            <Link to={`/admin/claims/${claim.claimId}`}>Review Claim</Link>
          </div>
        ))}
      </div>
      <PaginationControls
        pagination={data?.pagination}
        onPageChange={setPage}
      />
    </section>
  );
}
