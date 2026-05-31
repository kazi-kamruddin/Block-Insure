import { Link, Outlet } from "react-router-dom";
import { useWallet } from "../context/useWallet";

export default function AuditorLayout() {
  const { isConnected, role, connectWallet, isConnecting } = useWallet();

  if (!isConnected) {
    return (
      <section className="page-container">
        <h2>Auditor area</h2>
        <p>Connect auditor wallet first.</p>
        <button type="button" onClick={connectWallet} disabled={isConnecting}>
          {isConnecting ? "Connecting..." : "Connect Wallet"}
        </button>
      </section>
    );
  }

  if (role !== "AUDITOR" && role !== "ADMIN") {
    return (
      <section className="page-container">
        <h2>Access denied</h2>
        <p>Your backend role is {role}. Auditor or Admin role is required.</p>
      </section>
    );
  }

  return (
    <div>
      <div className="subnav">
        <Link to="/auditor/dashboard">Dashboard</Link>
        <Link to="/auditor/claims">Claims</Link>
      </div>

      <Outlet />
    </div>
  );
}