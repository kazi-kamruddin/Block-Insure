import { Navigate, NavLink, Outlet } from "react-router-dom";
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
      <nav className="subnav" aria-label="Administration navigation">
        <NavLink to="/admin/dashboard" end>Overview</NavLink>
        <NavLink to="/admin/policy-packages" end>Packages</NavLink>
        <NavLink to="/admin/policy-packages/new">Create Package</NavLink>
        <NavLink to="/admin/healthcare-registry">Registry</NavLink>
        <NavLink to="/admin/thesis-dashboard">Thesis Results</NavLink>
        <NavLink to="/admin/audit-actions">Action Audit</NavLink>
        <NavLink to="/admin/role-health">Role Health</NavLink>
        <NavLink to="/admin/claims">Claims</NavLink>
        <NavLink to="/admin/notifications">Notifications</NavLink>
      </nav>

      <Outlet />
    </div>
  );
}
