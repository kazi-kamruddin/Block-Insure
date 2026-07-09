import { useQuery } from "@tanstack/react-query";

import { getAdminRoleSyncHealth } from "../services/api";

export default function AdminRoleHealthPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["adminRoleSyncHealthDetail"],
    queryFn: getAdminRoleSyncHealth,
  });
  const rows = data?.rows || [];

  return (
    <section className="page-container">
      <h2>Role Sync Health</h2>
      <p>
        Diagnostic only. MongoDB role metadata is compared against on-chain
        ADMIN_ROLE, AUDITOR_ROLE, and ORACLE_ROLE grants.
      </p>

      <button type="button" onClick={() => refetch()} disabled={isLoading}>
        {isLoading ? "Checking..." : "Refresh Role Check"}
      </button>

      {error ? (
        <p className="error-text">
          {error.response?.data?.message || error.message || "Role check failed"}
        </p>
      ) : null}

      <div className="card">
        <h3>Summary</h3>
        <p>Checked wallets: {data?.summary?.checkedWallets || 0}</p>
        <p>Mismatches: {data?.summary?.mismatches || 0}</p>
        <p>Status: {data?.summary?.healthy ? "Healthy" : "Needs attention"}</p>
      </div>

      <div className="card reserve-table-card">
        <h3>Role Matrix</h3>
        <table className="reserve-table">
          <thead>
            <tr>
              <th>Wallet</th>
              <th>Backend Role</th>
              <th>On-Chain Roles</th>
              <th>Status</th>
              <th>Issue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.walletAddress}-${row.backendRole}`}>
                <td>{row.walletAddress}</td>
                <td>{row.backendRole}</td>
                <td>{row.onChainRoles?.join(", ") || "-"}</td>
                <td>{row.healthy ? "Healthy" : "Mismatch"}</td>
                <td>{row.issues?.join("; ") || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!isLoading && rows.length === 0 ? <p>No privileged users found.</p> : null}
      </div>
    </section>
  );
}
