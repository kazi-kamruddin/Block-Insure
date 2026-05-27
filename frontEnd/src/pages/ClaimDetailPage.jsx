import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import ClaimStatusBadge from "../components/ClaimStatusBadge";
import { getClaimById, getOracleResults } from "../services/api";

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

function formatValue(value) {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function ClaimDetailPage() {
  const { id } = useParams();

  const {
    data: claimData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["claim", id],
    queryFn: () => getClaimById(id),
    enabled: Boolean(id),
  });

  const {
    data: oracleData,
    isLoading: oracleLoading,
    refetch: refetchOracle,
  } = useQuery({
    queryKey: ["oracleResults", id],
    queryFn: () => getOracleResults(id),
    enabled: Boolean(id),
  });

  const claim = extractClaim(claimData);
  const oracleLogs = extractOracleLogs(oracleData);

  return (
    <section className="page-container">
      <h2>Claim Detail</h2>

      <button
        type="button"
        onClick={() => {
          refetch();
          refetchOracle();
        }}
      >
        Refresh Claim
      </button>

      <p>
        <Link to="/user/claims">Back to My Claims</Link>
      </p>

      {isLoading ? <p>Loading claim...</p> : null}

      {error ? (
        <p className="error-text">
          {error.message || "Could not load claim detail"}
        </p>
      ) : null}

      {claim ? (
        <div className="card">
          <h3>Claim #{formatValue(claim.claimId || id)}</h3>

          <p>Policy ID: {formatValue(claim.policyId)}</p>
          <p>Claimant: {formatValue(claim.claimantWallet)}</p>
          <p>Amount: {formatValue(claim.claimAmountEth || claim.claimAmount)} ETH</p>
          <p>Claim type: {formatValue(claim.claimType)}</p>
          <p>Hospital ID: {formatValue(claim.hospitalId)}</p>
          <p>Invoice hash: {formatValue(claim.invoiceHash)}</p>
          <p>Document hash: {formatValue(claim.documentHash)}</p>
          <p>Document CID: {formatValue(claim.documentCID)}</p>
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
          <p>Risk score: {formatValue(claim.riskScore)}</p>
          <p>Submitted at: {formatValue(claim.submittedAtFormatted || claim.submittedAt)}</p>
        </div>
      ) : null}

      <h3>Oracle Results</h3>

      {oracleLoading ? <p>Loading oracle logs...</p> : null}

      {!oracleLoading && oracleLogs.length === 0 ? (
        <p>No oracle result found yet.</p>
      ) : null}

      {oracleLogs.map((log) => (
        <div className="card" key={log._id || log.requestId || log.resultHash}>
          <p>Request ID: {formatValue(log.requestId)}</p>
          <p>Verified: {formatValue(log.verified)}</p>
          <p>Risk level: {formatValue(log.riskLevel)}</p>
          <p>Result hash: {formatValue(log.resultHash)}</p>
          <p>Tx hash: {formatValue(log.submittedTxHash || log.txHash)}</p>
        </div>
      ))}
    </section>
  );
}