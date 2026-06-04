import { Link, Outlet } from "react-router-dom";
import { useWallet } from "../context/useWallet";

export default function AdminLayout() {
  const { isConnected, role, connectWallet, isConnecting } = useWallet();

  if (!isConnected) {
    return (
      <section className="page-container">
        <h2>Admin area</h2>
        <p>Connect admin wallet first.</p>
        <button type="button" onClick={connectWallet} disabled={isConnecting}>
          {isConnecting ? "Connecting..." : "Connect Wallet"}
        </button>
      </section>
    );
  }

  if (role !== "ADMIN") {
    return (
      <section className="page-container">
        <h2>Access denied</h2>
        <p>Your backend role is {role}. Admin role is required.</p>
      </section>
    );
  }

  return (
    <div>
      <div className="subnav">
        <Link to="/admin/dashboard">Dashboard</Link>
        <Link to="/admin/policy-packages">Packages</Link>
        <Link to="/admin/policy-packages/new">Create Package</Link>
        <Link to="/admin/healthcare-registry">Registry</Link>
        <Link to="/admin/thesis-dashboard">Thesis Results</Link>
        <Link to="/admin/claims">Claims</Link>
        <Link to="/admin/notifications">Notifications</Link>
      </div>

      <Outlet />
    </div>
  );
}
