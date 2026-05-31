import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import ClaimStatusBadge from "../components/ClaimStatusBadge";
import { getAdminClaims } from "../services/api";

function extractClaims(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.claims)) return data.claims;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

export default function AdminClaimListPage() {
  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["adminClaims"],
    queryFn: getAdminClaims,
  });

  const claims = extractClaims(data);

  return (
    <section className="page-container">
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

      {!isLoading && claims.length === 0 ? <p>No claims found.</p> : null}

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
    </section>
  );
}