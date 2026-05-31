import { useEffect, useState } from "react";
import { api } from "../services/api";
import { formatEth, getReadOnlyContract } from "../services/contractService";

export default function AdminDashboardPage() {
  const [contractBalance, setContractBalance] = useState("0");
  const [claimCount, setClaimCount] = useState("-");
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadDashboard() {
      try {
        const contract = getReadOnlyContract();
        const balance = await contract.getContractBalance();
        setContractBalance(formatEth(balance));

        const response = await api.get("/api/admin/claims");
        const claims = response.data.claims || response.data || [];
        setClaimCount(Array.isArray(claims) ? claims.length : "-");
      } catch (err) {
        console.error(err);
        setError(err.message || "Could not load admin dashboard");
      }
    }

    loadDashboard();
  }, []);

  return (
    <section className="page-container">
      <h2>Admin Dashboard</h2>
      {error ? <p className="error-text">{error}</p> : null}

      <div className="card-row">
        <div className="card">
          <strong>Contract Balance</strong>
          <p>{contractBalance} ETH</p>
        </div>

        <div className="card">
          <strong>Total Claims</strong>
          <p>{claimCount}</p>
        </div>
      </div>
    </section>
  );
}