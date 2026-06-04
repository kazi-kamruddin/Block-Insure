import { Navigate, NavLink, Outlet } from "react-router-dom";
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
      <nav className="subnav" aria-label="Policyholder navigation">
        <NavLink to="/user/dashboard" end>Overview</NavLink>
        <NavLink to="/user/policies/buy">Buy Policy</NavLink>
        <NavLink to="/user/policies" end>My Policies</NavLink>
        <NavLink to="/user/claims" end>My Claims</NavLink>
        <NavLink to="/user/claims/new">Submit Claim</NavLink>
        <NavLink to="/user/notifications">Notifications</NavLink>
      </nav>

      <Outlet />
    </div>
  );
}
