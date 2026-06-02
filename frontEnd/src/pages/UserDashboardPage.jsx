import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { getMyClaims, getMyPolicies } from "../services/api";
import { useWallet } from "../context/useWallet";
import { getStatusLabel } from "../services/contractService";
import "../styles/pages/UserDashboardPage.css";

function extractPolicies(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.policies)) return data.policies;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function extractClaims(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.claims)) return data.claims;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function normalizeStatus(status) {
  if (status === undefined || status === null) return "UNKNOWN";

  if (typeof status === "object") {
    if (status.label) return status.label;
    if (status.name) return status.name;
    if (status.statusLabel) return status.statusLabel;
    if (status.statusName) return status.statusName;
    if (status.code !== undefined) return getStatusLabel(status.code);
    if (status.value !== undefined) return getStatusLabel(status.value);
    if (status._hex) return getStatusLabel(Number(status._hex));
    return "UNKNOWN";
  }

  if (typeof status === "number") return getStatusLabel(status);
  if (!Number.isNaN(Number(status))) return getStatusLabel(Number(status));

  return status;
}

function getClaimStatusName(claim) {
  return normalizeStatus(
    claim?.statusLabel || claim?.statusName || claim?.statusCode || claim?.status
  );
}

export default function UserDashboardPage() {
  const { walletAddress, role, isConnected } = useWallet();

  const {
    data: policiesData,
    isLoading: policiesLoading,
    refetch: refetchPolicies,
  } = useQuery({
    queryKey: ["userDashboardPolicies", walletAddress],
    queryFn: getMyPolicies,
    enabled: isConnected,
  });

  const {
    data: claimsData,
    isLoading: claimsLoading,
    refetch: refetchClaims,
  } = useQuery({
    queryKey: ["userDashboardClaims", walletAddress],
    queryFn: getMyClaims,
    enabled: isConnected,
  });

  const policies = extractPolicies(policiesData);
  const claims = extractClaims(claimsData);

  const activePolicies = policies.filter((policy) => policy.isActive !== false);
  const settledClaims = claims.filter(
    (claim) => getClaimStatusName(claim) === "SETTLED"
  );
  const rejectedClaims = claims.filter(
    (claim) => getClaimStatusName(claim) === "REJECTED"
  );
  const fraudClaims = claims.filter(
    (claim) => getClaimStatusName(claim) === "FRAUD_FLAGGED"
  );

  return (
    <section className="page-container page-user-dashboard">
      <h2>User Dashboard</h2>

      <div className="card">
        <p>Wallet: {walletAddress}</p>
        <p>Role: {role}</p>
      </div>

      <div className="action-row">
        <button
          type="button"
          onClick={() => {
            refetchPolicies();
            refetchClaims();
          }}
        >
          Refresh Dashboard
        </button>

        <Link to="/user/policies/buy">Buy Policy</Link>
        <Link to="/user/claims/new">Submit Claim</Link>
        <Link to="/user/claims">My Claims</Link>
      </div>

      <div className="card-row">
        <div className="card">
          <h3>Purchased Policies</h3>
          <p>{policiesLoading ? "Loading..." : policies.length}</p>
        </div>

        <div className="card">
          <h3>Active Policies</h3>
          <p>{policiesLoading ? "Loading..." : activePolicies.length}</p>
        </div>

        <div className="card">
          <h3>Total Claims</h3>
          <p>{claimsLoading ? "Loading..." : claims.length}</p>
        </div>

        <div className="card">
          <h3>Settled Claims</h3>
          <p>{claimsLoading ? "Loading..." : settledClaims.length}</p>
        </div>

        <div className="card">
          <h3>Rejected Claims</h3>
          <p>{claimsLoading ? "Loading..." : rejectedClaims.length}</p>
        </div>

        <div className="card">
          <h3>Fraud Flagged</h3>
          <p>{claimsLoading ? "Loading..." : fraudClaims.length}</p>
        </div>
      </div>
    </section>
  );
}
