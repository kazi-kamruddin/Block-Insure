import { Link, Navigate, Outlet } from "react-router-dom";
import { useWallet } from "../context/useWallet";

export default function UserLayout() {
  const { isConnected, role, workspace } = useWallet();

  if (!isConnected) {
    return <Navigate to="/" replace />;
  }

  if (role !== "USER") {
    return <Navigate to={workspace?.home || "/"} replace />;
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
