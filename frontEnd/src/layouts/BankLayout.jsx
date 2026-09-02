import { Navigate, NavLink, Outlet } from "react-router-dom";
import { useWallet } from "../context/useWallet";

export default function BankLayout() {
  const { isConnected, isRestoringSession, role, workspace } = useWallet();

  if (isRestoringSession) {
    return <div className="route-loading" role="status">Restoring bank session...</div>;
  }
  if (!isConnected) return <Navigate to="/" replace />;
  if (role !== "BANK") return <Navigate to={workspace?.home || "/"} replace />;

  return (
    <div>
      <nav className="subnav" aria-label="Bank navigation">
        <NavLink to="/bank/dashboard" end>Bank Overview</NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
