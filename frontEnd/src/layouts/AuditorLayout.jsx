import { Link, Navigate, Outlet } from "react-router-dom";
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
      <div className="subnav">
        <Link to="/auditor/dashboard">Dashboard</Link>
        <Link to="/auditor/healthcare-registry">Registry</Link>
        <Link to="/auditor/claims">Claims</Link>
        <Link to="/auditor/verify-document">Verify Document</Link>
        <Link to="/auditor/reputation">Reputation</Link>
      </div>

      <Outlet />
    </div>
  );
}
