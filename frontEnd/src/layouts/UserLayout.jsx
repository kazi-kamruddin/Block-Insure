import { Link, Outlet } from "react-router-dom";
import { useWallet } from "../context/useWallet";

export default function UserLayout() {
  const { isConnected, connectWallet, isConnecting } = useWallet();

  if (!isConnected) {
    return (
      <section className="page-container">
        <h2>User area</h2>
        <p>Connect wallet first.</p>
        <button type="button" onClick={connectWallet} disabled={isConnecting}>
          {isConnecting ? "Connecting..." : "Connect Wallet"}
        </button>
      </section>
    );
  }

  return (
    <div>
      <div className="subnav">
        <Link to="/user/dashboard">Dashboard</Link>
        <Link to="/user/policies/buy">Buy Policy</Link>
        <Link to="/user/policies">My Policies</Link>
        <Link to="/user/claims">My Claims</Link>
        <Link to="/user/claims/new">Submit Claim</Link>
        <Link to="/user/notifications">Notifications</Link>
      </div>

      <Outlet />
    </div>
  );
}
