import { Navigate, NavLink, Outlet } from "react-router-dom";
import { useWallet } from "../context/useWallet";

export default function HospitalLayout() {
  const { isConnected, isRestoringSession, role, workspace } = useWallet();

  if (isRestoringSession) {
    return <div className="route-loading" role="status">Restoring hospital session...</div>;
  }
  if (!isConnected) return <Navigate to="/" replace />;
  if (role !== "HOSPITAL") return <Navigate to={workspace?.home || "/"} replace />;

  return (
    <div>
      <nav className="subnav" aria-label="Hospital navigation">
        <NavLink to="/hospital/dashboard" end>Overview</NavLink>
        <NavLink to="/hospital/records">Patient &amp; Invoices</NavLink>
        <NavLink to="/hospital/claims">Claim Requests</NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
