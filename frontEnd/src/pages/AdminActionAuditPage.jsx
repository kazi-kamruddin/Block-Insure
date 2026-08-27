import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import TransactionLink from "../components/TransactionLink";
import { getAdminActionLogs } from "../services/api";

function formatValue(value) {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function summarizeMetadata(metadata) {
  if (!metadata || Object.keys(metadata).length === 0) return "-";
  return Object.entries(metadata)
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${formatValue(value)}`)
    .join(" | ");
}

export default function AdminActionAuditPage() {
  const [filters, setFilters] = useState({
    action: "",
    actorWallet: "",
    targetType: "",
    targetId: "",
  });
  const queryParams = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(filters).filter(([, value]) => value.trim())
      ),
    [filters]
  );
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["adminActionLogs", queryParams],
    queryFn: () => getAdminActionLogs(queryParams),
  });
  const logs = data?.logs || [];

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  return (
    <section className="page-container">
      <h2>Admin Action Audit</h2>

      <div className="card">
        <div className="form-grid">
          <label>
            Actor wallet
            <input
              value={filters.actorWallet}
              onChange={(event) => updateFilter("actorWallet", event.target.value)}
              placeholder="0x..."
            />
          </label>
          <label>
            Action
            <input
              value={filters.action}
              onChange={(event) => updateFilter("action", event.target.value)}
              placeholder="APPROVE_CLAIM"
            />
          </label>
          <label>
            Target type
            <input
              value={filters.targetType}
              onChange={(event) => updateFilter("targetType", event.target.value)}
              placeholder="CLAIM"
            />
          </label>
          <label>
            Target ID
            <input
              value={filters.targetId}
              onChange={(event) => updateFilter("targetId", event.target.value)}
              placeholder="1"
            />
          </label>
        </div>

        <button type="button" onClick={() => refetch()} disabled={isLoading}>
          {isLoading ? "Loading..." : "Refresh Logs"}
        </button>
      </div>

      {error ? (
        <p className="error-text">
          {error.response?.data?.message || error.message || "Could not load logs"}
        </p>
      ) : null}

      <div className="card">
        <h3>Logs</h3>
        <p>{data?.total ?? logs.length} matching actions</p>

        <div className="thesis-table-wrap">
          <table className="thesis-table">
            <thead>
              <tr>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>Tx</th>
                <th>Block</th>
                <th>Timestamp</th>
                <th>Route</th>
                <th>Metadata</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log._id}>
                  <td>
                    {formatValue(log.actorWallet)}
                    <br />
                    <small>{formatValue(log.actorRole)}</small>
                  </td>
                  <td>{formatValue(log.action)}</td>
                  <td>
                    {formatValue(log.targetType)} #{formatValue(log.targetId)}
                  </td>
                  <td><TransactionLink txHash={log.transactionHash} /></td>
                  <td>{formatValue(log.blockNumber)}</td>
                  <td>{formatDate(log.createdAt)}</td>
                  <td>
                    {formatValue(log.request?.method)} {formatValue(log.request?.path)}
                  </td>
                  <td>{summarizeMetadata(log.metadata)}</td>
                </tr>
              ))}
              {!logs.length && !isLoading ? (
                <tr>
                  <td colSpan="8">No admin actions found.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
