import { Navigate, NavLink, Outlet } from "react-router-dom";
import { useWallet } from "../context/useWallet";

export default function AuditorLayout() {
  const { isConnected, role, workspace } = useWallet();

  if (!isConnected) {
    return <Navigate to="/" replace />;
  }

  if (role !== "AUDITOR") {
    return <Navigate to={workspace?.home || "/"} replace />;
  }

  return (
    <div>
      <nav className="subnav" aria-label="Auditor navigation">
        <NavLink to="/auditor/dashboard" end>Overview</NavLink>
        <NavLink to="/auditor/healthcare-registry">Registry</NavLink>
        <NavLink to="/auditor/claims">Audit Timelines</NavLink>
        <NavLink to="/auditor/votes">Voting Queue</NavLink>
        <NavLink to="/auditor/verify-document">Verify Document</NavLink>
        <NavLink to="/auditor/reputation">Reputation</NavLink>
      </nav>

      <Outlet />
    </div>
  );
}
