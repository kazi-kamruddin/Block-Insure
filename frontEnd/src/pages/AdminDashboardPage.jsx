import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { getAdminClaims } from "../services/api";
import {
  formatEth,
  getReadOnlyContract,
} from "../services/contractService";
import { getClaimStatusName } from "../utils/claimStatus";
import "../styles/pages/AdminDashboardPage.css";

function extractClaims(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.claims)) return data.claims;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function countByStatus(claims, statusName) {
  return claims.filter((claim) => getClaimStatusName(claim) === statusName).length;
}

async function getContractBalanceEth() {
  const contract = getReadOnlyContract();
  const balance = await contract.getContractBalance();
  return formatEth(balance);
}

export default function AdminDashboardPage() {
  const {
    data: balanceData,
    isLoading: balanceLoading,
    error: balanceError,
    refetch: refetchBalance,
  } = useQuery({
    queryKey: ["adminContractBalance"],
    queryFn: getContractBalanceEth,
  });

  const {
    data: claimsData,
    isLoading: claimsLoading,
    error: claimsError,
    refetch: refetchClaims,
  } = useQuery({
    queryKey: ["adminDashboardClaims"],
    queryFn: getAdminClaims,
  });

  const claims = extractClaims(claimsData);

  return (
    <section className="page-container page-admin-dashboard">
      <h2>Admin Dashboard</h2>

      <div className="action-row">
        <button
          type="button"
          onClick={() => {
            refetchBalance();
            refetchClaims();
          }}
        >
          Refresh Dashboard
        </button>

        <Link to="/admin/policy-packages">Manage Packages</Link>
        <Link to="/admin/claims">Review Claims</Link>
      </div>

      {balanceError ? (
        <p className="error-text">
          {balanceError.message || "Could not load contract balance"}
        </p>
      ) : null}

      {claimsError ? (
        <p className="error-text">
          {claimsError.message || "Could not load claim summary"}
        </p>
      ) : null}

      <div className="card-row">
        <div className="card">
          <h3>Contract Reserve</h3>
          <p className="metric-value">
            {balanceLoading ? "Loading..." : `${balanceData} ETH`}
          </p>
          <p>Central contract balance available for claim payouts.</p>
        </div>

        <div className="card">
          <h3>Total Claims</h3>
          <p className="metric-value">{claimsLoading ? "Loading..." : claims.length}</p>
        </div>

        <div className="card">
          <h3>Duplicate Checked</h3>
          <p className="metric-value">{countByStatus(claims, "DUPLICATE_CHECKED")}</p>
        </div>

        <div className="card">
          <h3>Oracle Pending</h3>
          <p className="metric-value">{countByStatus(claims, "ORACLE_PENDING")}</p>
        </div>

        <div className="card">
          <h3>Oracle Verified</h3>
          <p className="metric-value">{countByStatus(claims, "ORACLE_VERIFIED")}</p>
        </div>

        <div className="card">
          <h3>Fraud Flagged</h3>
          <p className="metric-value">{countByStatus(claims, "FRAUD_FLAGGED")}</p>
        </div>

        <div className="card">
          <h3>Manual Review</h3>
          <p className="metric-value">{countByStatus(claims, "MANUAL_REVIEW")}</p>
        </div>

        <div className="card">
          <h3>Rejected</h3>
          <p className="metric-value">{countByStatus(claims, "REJECTED")}</p>
        </div>

        <div className="card">
          <h3>Settled</h3>
          <p className="metric-value">{countByStatus(claims, "SETTLED")}</p>
        </div>
      </div>
    </section>
  );
}
