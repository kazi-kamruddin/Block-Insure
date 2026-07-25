import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";

import {
  getAdminRoleSyncHealth,
  getOracleHealth,
  getReserveIntelligence,
  reconcilePendingAdminTransactions,
} from "../services/api";
import "../styles/pages/AdminDashboardPage.css";

function extractReserveIntelligence(data) {
  return data?.reserveIntelligence || data?.data?.reserveIntelligence || null;
}

function formatEthValue(value) {
  if (value === undefined || value === null || value === "") return "0";
  return Number(value).toFixed(4).replace(/\.?0+$/, "");
}

function formatRatio(value) {
  if (value === null || value === undefined) return "-";
  return `${Math.round(Number(value) * 100)}%`;
}

function getBreakdownCount(intelligence, status) {
  return intelligence?.claimStatusBreakdown?.[status]?.count || 0;
}

export default function AdminDashboardPage() {
  const [reconciliationMessage, setReconciliationMessage] = useState("");

  useEffect(() => {
    reconcilePendingAdminTransactions()
      .then(({ confirmed, remaining }) => {
        if (confirmed > 0 || remaining > 0) {
          setReconciliationMessage(
            `${confirmed} pending admin transaction(s) reconciled; ${remaining} still pending.`
          );
        }
      })
      .catch(() => {});
  }, []);

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["reserveIntelligence"],
    queryFn: getReserveIntelligence,
  });
  const roleHealthQuery = useQuery({
    queryKey: ["adminRoleSyncHealth"],
    queryFn: getAdminRoleSyncHealth,
  });
  const oracleHealthQuery = useQuery({
    queryKey: ["oracleHealth"],
    queryFn: getOracleHealth,
  });

  const intelligence = extractReserveIntelligence(data);
  const settlementQueue = intelligence?.settlementQueue || [];
  const solvencyStatus = intelligence?.solvency?.status || "UNKNOWN";
  const roleHealth = roleHealthQuery.data;
  const oracleHealth = oracleHealthQuery.data?.oracles || [];
  const isRefreshing =
    isFetching || roleHealthQuery.isFetching || oracleHealthQuery.isFetching;

  function refreshAll() {
    refetch();
    roleHealthQuery.refetch();
    oracleHealthQuery.refetch();
  }

  return (
    <section className="page-container page-admin-dashboard">
      {reconciliationMessage ? (
        <p className="success-text">{reconciliationMessage}</p>
      ) : null}
      <div className="dashboard-heading">
        <div>
          <span className="dashboard-eyebrow">Administration workspace</span>
          <h2>Portfolio oversight</h2>
          <p>
            Monitor reserve health, manage coverage products, review claim
            decisions, and control final settlement.
          </p>
        </div>
        <div className="dashboard-heading-side">
          <span className="dashboard-context-pill">Privileged operations</span>
          <button
            className="dashboard-refresh-button"
            type="button"
            onClick={refreshAll}
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refreshing..." : "Refresh data"}
          </button>
        </div>
      </div>

      {error ? (
        <p className="error-text">
          {error.response?.data?.message ||
            error.message ||
            "Could not load reserve intelligence"}
        </p>
      ) : null}

      {roleHealthQuery.error || oracleHealthQuery.error ? (
        <div className="status-message is-error" role="alert">
          <strong>Some operational diagnostics are unavailable.</strong>
          <span>
            {roleHealthQuery.error?.response?.data?.message ||
              roleHealthQuery.error?.message ||
              oracleHealthQuery.error?.response?.data?.message ||
              oracleHealthQuery.error?.message}
          </span>
        </div>
      ) : null}

      {isLoading ? <p>Loading reserve intelligence...</p> : null}

      {intelligence ? (
        <div className={`reserve-status-banner status-${solvencyStatus.toLowerCase()}`}>
          <div>
            <span>Solvency status</span>
            <strong>{solvencyStatus}</strong>
          </div>
          <p>
            Reserve after approved queue:{" "}
            {formatEthValue(intelligence.solvency.reserveAfterApprovedQueueEth)} ETH
          </p>
        </div>
      ) : null}

      <div className="card-row">
        <div className="card">
          <h3>Contract Reserve</h3>
          <p className="metric-value">
            {isLoading
              ? "Loading..."
              : `${formatEthValue(intelligence?.reserve?.eth)} ETH`}
          </p>
          <p>Central contract balance available for claim payouts.</p>
        </div>

        <div className="card">
          <h3>Open Exposure</h3>
          <p className="metric-value">
            {formatEthValue(intelligence?.liabilities?.openExposureEth)} ETH
          </p>
          <p>{formatRatio(intelligence?.ratios?.reserveToOpenExposure)} reserve cover.</p>
        </div>

        <div className="card">
          <h3>Approved Liability</h3>
          <p className="metric-value">
            {formatEthValue(
              intelligence?.liabilities?.approvedPendingExposureEth ||
                intelligence?.liabilities?.approvedLiabilityEth
            )} ETH
          </p>
          <p>
            {intelligence?.liabilities?.unsettledApprovedClaimCount || 0} unsettled approved claims.
          </p>
        </div>

        <div className="card">
          <h3>Review Exposure</h3>
          <p className="metric-value">
            {formatEthValue(intelligence?.liabilities?.reviewExposureEth)} ETH
          </p>
          <p>Claims flagged, failed by oracle, or waiting for manual review.</p>
        </div>

        <div className="card">
          <h3>Premium Collected</h3>
          <p className="metric-value">
            {formatEthValue(intelligence?.portfolio?.premiumCollectedEth)} ETH
          </p>
          <p>{intelligence?.portfolio?.activePolicies || 0} active policies.</p>
        </div>

        <div className="card">
          <h3>Settlements Paid</h3>
          <p className="metric-value">
            {formatEthValue(intelligence?.liabilities?.totalSettlementsPaidEth)} ETH
          </p>
          <p>Authoritative paid settlement records from contract state.</p>
        </div>

        <div className="card">
          <h3>Reserve After Exposure</h3>
          <p className="metric-value">
            {formatEthValue(intelligence?.solvency?.reserveAfterPendingExposureEth)} ETH
          </p>
          <p>
            Warning threshold: {formatEthValue(intelligence?.reserve?.warningThresholdEth)} ETH.
          </p>
        </div>

        <div className="card">
          <h3>Active Coverage</h3>
          <p className="metric-value">
            {formatEthValue(intelligence?.portfolio?.activeCoverageEth)} ETH
          </p>
          <p>
            {formatRatio(intelligence?.ratios?.reserveToActiveCoverage)} reserve to
            coverage.
          </p>
        </div>

        <div className="card">
          <h3>Total Claims</h3>
          <p className="metric-value">{intelligence?.portfolio?.totalClaims || 0}</p>
          <p>{getBreakdownCount(intelligence, "SETTLED")} settled so far.</p>
        </div>

        <div className="card">
          <h3>Manual Review</h3>
          <p className="metric-value">{getBreakdownCount(intelligence, "MANUAL_REVIEW")}</p>
          <p>{getBreakdownCount(intelligence, "ORACLE_FAILED")} oracle failed.</p>
        </div>

        <div className="card">
          <h3>Rejected</h3>
          <p className="metric-value">{getBreakdownCount(intelligence, "REJECTED")}</p>
          <p>{getBreakdownCount(intelligence, "FRAUD_FLAGGED")} fraud flagged.</p>
        </div>

        <div className="card">
          <h3>Role Sync</h3>
          <p className="metric-value">
            {roleHealthQuery.isLoading
              ? "Loading..."
              : roleHealthQuery.error
                ? "Unavailable"
              : roleHealth?.summary?.healthy
                ? "Healthy"
                : `${roleHealth?.summary?.mismatches || 0} mismatch`}
          </p>
          <p>Backend roles compared with on-chain role grants.</p>
          <Link to="/admin/role-health">Open diagnostics</Link>
        </div>

        <div className="card">
          <h3>Oracle Health</h3>
          <p className="metric-value">
            {oracleHealthQuery.isLoading
              ? "Loading..."
              : oracleHealthQuery.error
                ? "Unavailable"
                : oracleHealth.length}
          </p>
          <p>
            {oracleHealthQuery.error
              ? "Check the backend and oracle health endpoint."
              : oracleHealth.length === 0
                ? "No heartbeats yet. Start both oracle workers."
                : `${oracleHealth.filter((oracle) => oracle.status === "ONLINE").length} online, ${oracleHealth.filter((oracle) => oracle.status === "STALE").length} stale.`}
          </p>
        </div>
      </div>

      {oracleHealth.length > 0 ? (
        <div className="card reserve-table-card">
          <h3>Oracle Identity and Independence</h3>
          <table className="reserve-table">
            <thead>
              <tr>
                <th>Oracle</th>
                <th>Wallet</th>
                <th>Registry Root</th>
                <th>Heartbeat</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {oracleHealth.map((oracle) => (
                <tr key={oracle.id || oracle.oracleWallet || oracle.oracleInstanceId}>
                  <td>{oracle.label || oracle.oracleInstanceId || "Oracle"}</td>
                  <td>{oracle.oracleWallet || "-"}</td>
                  <td>{oracle.registryRoot || oracle.registrySnapshot || "-"}</td>
                  <td>
                    {oracle.lastHeartbeatAt
                      ? new Date(oracle.lastHeartbeatAt).toLocaleString()
                      : "-"}
                  </td>
                  <td>{oracle.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {intelligence ? (
        <div className="reserve-grid">
          <div className="card reserve-table-card">
            <h3>Claim Status Liability</h3>
            <table className="reserve-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Count</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(intelligence.claimStatusBreakdown || {}).map(
                  ([status, item]) =>
                    item.count > 0 ? (
                      <tr key={status}>
                        <td>{status}</td>
                        <td>{item.count}</td>
                        <td>{formatEthValue(item.amountEth)} ETH</td>
                      </tr>
                    ) : null
                )}
              </tbody>
            </table>
          </div>

          <div className="card reserve-table-card">
            <h3>Approved Settlement Queue</h3>

            {settlementQueue.length === 0 ? (
              <p>No approved claims waiting for settlement.</p>
            ) : (
              <table className="reserve-table">
                <thead>
                  <tr>
                    <th>Claim</th>
                    <th>Amount</th>
                    <th>Projected Reserve</th>
                  </tr>
                </thead>
                <tbody>
                  {settlementQueue.map((claim) => (
                    <tr key={claim.claimId}>
                      <td>
                        <Link to={`/admin/claims/${claim.claimId}`}>
                          #{claim.claimId}
                        </Link>
                      </td>
                      <td>{formatEthValue(claim.claimAmountEth)} ETH</td>
                      <td>{formatEthValue(claim.projectedReserveAfterEth)} ETH</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
