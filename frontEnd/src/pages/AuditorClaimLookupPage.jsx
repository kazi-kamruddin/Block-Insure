import { Link } from "react-router-dom";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import ClaimStatusBadge from "../components/ClaimStatusBadge";
import PaginationControls from "../components/PaginationControls";
import { getAllReadableClaims } from "../services/api";
import { getClaimStatusName, getStatusExplanation } from "../utils/claimStatus";
import "../styles/pages/AuditorClaimLookupPage.css";

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

function formatDate(timestamp) {
  if (!timestamp?.iso) return "-";
  return new Date(timestamp.iso).toLocaleString();
}

export default function AuditorClaimLookupPage() {
  const [page, setPage] = useState(1);
  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["auditorAllClaims", page],
    queryFn: () => getAllReadableClaims({ page }),
  });

  const claims = extractClaims(data);

  return (
    <section className="page-container page-auditor-claim-lookup">
      <div className="page-heading-row">
        <div>
          <h2>Claim Audit Timelines</h2>
          <p>
            Every submitted claim has an audit trail. Choose any claim below to
            inspect its blockchain events, oracle evidence, documents, votes,
            appeals, settlement, and closure history.
          </p>
        </div>
        <button type="button" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Refreshing..." : "Refresh Claims"}
        </button>
      </div>

      {error ? (
        <p className="error-text">
          {error.response?.data?.message ||
            error.message ||
            "Could not load claims"}
        </p>
      ) : null}

      {isLoading ? <p>Loading claims...</p> : null}
      {!isLoading && claims.length === 0 ? <p>No claims found.</p> : null}

      {claims.length > 0 ? (
        <div className="auditor-claim-list">
          {claims.map((claim) => {
            const statusName = getClaimStatusName(claim);

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
                  <span>Submitted {formatDate(claim.submittedAt)}</span>
                </div>

                <Link to={`/auditor/claims/${claim.claimId}/history`}>
                  View Audit Timeline
                </Link>
              </article>
            );
          })}
        </div>
      ) : null}
      <PaginationControls
        pagination={data?.pagination}
        onPageChange={setPage}
      />
    </section>
  );
}
