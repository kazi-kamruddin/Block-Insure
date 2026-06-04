import { Link, Navigate, Outlet } from "react-router-dom";
import { useWallet } from "../context/useWallet";

export default function AdminLayout() {
  const { isConnected, role, workspace } = useWallet();

  if (!isConnected) {
    return <Navigate to="/" replace />;
  }

  if (role !== "ADMIN") {
    return <Navigate to={workspace?.home || "/"} replace />;
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
