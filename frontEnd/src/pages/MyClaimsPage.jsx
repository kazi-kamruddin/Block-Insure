import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import ClaimStatusBadge from "../components/ClaimStatusBadge";
import { getMyClaims } from "../services/api";
import { useWallet } from "../context/useWallet";

function extractClaims(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.claims)) return data.claims;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

export default function MyClaimsPage() {
  const { isConnected, walletAddress } = useWallet();

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["myClaims", walletAddress],
    queryFn: getMyClaims,
    enabled: isConnected,
  });

  const claims = extractClaims(data);

  return (
    <section className="page-container">
      <h2>My Claims</h2>

      <button
        type="button"
        onClick={() => refetch()}
        disabled={!isConnected || isFetching}
      >
        {isFetching ? "Refreshing..." : "Refresh My Claims"}
      </button>

      {error ? (
        <p className="error-text">
          {error.message || "Could not load your claims"}
        </p>
      ) : null}

      {isLoading ? <p>Loading claims...</p> : null}

      {!isLoading && claims.length === 0 ? (
        <p>No claims found for this wallet yet.</p>
      ) : null}

      <div className="card-row">
        {claims.map((claim) => (
          <div className="card" key={claim.claimId}>
            <h3>Claim #{claim.claimId}</h3>

            <p>Policy ID: {claim.policyId}</p>
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
            <p>Document CID: {claim.documentCID || "-"}</p>

            <Link to={`/user/claims/${claim.claimId}`}>View Details</Link>
          </div>
        ))}
      </div>
    </section>
  );
}