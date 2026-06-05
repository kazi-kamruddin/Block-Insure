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
  const { walletAddress, isConnected } = useWallet();

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
  const openClaims = claims.filter(
    (claim) =>
      !["SETTLED", "REJECTED", "CLOSED"].includes(getClaimStatusName(claim))
  );
  const recommendedAction =
    activePolicies.length === 0
      ? {
          title: "Start with suitable coverage",
          description:
            "Purchase an active policy before an incident occurs so eligible claims can be submitted within its coverage period.",
          label: "Browse Policies",
          to: "/user/policies/buy",
        }
      : openClaims.length > 0
        ? {
            title: "Track your open claims",
            description:
              "Follow oracle verification, review decisions, evidence history, and settlement progress from your claim timeline.",
            label: "Review Open Claims",
            to: "/user/claims",
          }
        : {
            title: "Your coverage is ready",
            description:
              "Your active policy can support an eligible claim. Keep hospital invoices and supporting evidence available.",
            label: "Submit a Claim",
            to: "/user/claims/new",
          };

  return (
    <section className="page-container page-user-dashboard">
      <div className="dashboard-heading">
        <div>
          <span className="dashboard-eyebrow">Policyholder workspace</span>
          <h2>Coverage and claims overview</h2>
          <p>
            Manage active protection, submit evidence-backed claims, and follow
            every decision through settlement.
          </p>
        </div>
        <div className="dashboard-heading-side">
          <span className="dashboard-context-pill">Private account view</span>
          <button
            className="dashboard-refresh-button"
            type="button"
            onClick={() => {
              refetchPolicies();
              refetchClaims();
            }}
          >
            Refresh data
          </button>
        </div>
      </div>

      <div className="card dashboard-guidance-card">
        <div>
          <span className="dashboard-eyebrow">Recommended next step</span>
          <h3>{recommendedAction.title}</h3>
          <p>{recommendedAction.description}</p>
        </div>
        <Link to={recommendedAction.to}>{recommendedAction.label}</Link>
      </div>

      <div className="card-row dashboard-metric-grid">
        <div className="card">
          <h3>Purchased Policies</h3>
          <p className="metric-value">{policiesLoading ? "..." : policies.length}</p>
          <p>All coverage records connected to this account.</p>
        </div>

        <div className="card">
          <h3>Active Policies</h3>
          <p className="metric-value">{policiesLoading ? "..." : activePolicies.length}</p>
          <p>Policies currently eligible for claim submission.</p>
        </div>

        <div className="card">
          <h3>Total Claims</h3>
          <p className="metric-value">{claimsLoading ? "..." : claims.length}</p>
          <p>Complete claim history submitted by this account.</p>
        </div>

        <div className="card">
          <h3>Open Claims</h3>
          <p className="metric-value">{claimsLoading ? "..." : openClaims.length}</p>
          <p>Claims still moving through verification or review.</p>
        </div>
      </div>

      <div className="dashboard-status-strip">
        <div>
          <span>Settled</span>
          <strong>{claimsLoading ? "..." : settledClaims.length}</strong>
        </div>
        <div>
          <span>Rejected</span>
          <strong>{claimsLoading ? "..." : rejectedClaims.length}</strong>
        </div>
        <div>
          <span>Flagged for review</span>
          <strong>{claimsLoading ? "..." : fraudClaims.length}</strong>
        </div>
      </div>
    </section>
  );
}
