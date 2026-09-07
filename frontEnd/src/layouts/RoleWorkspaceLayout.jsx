import { Navigate, NavLink, Outlet } from "react-router-dom";
import { useWallet } from "../context/useWallet";

export default function RoleWorkspaceLayout({
  expectedRole,
  navigationLabel,
  links,
}) {
  const { isConnected, isRestoringSession, role, workspace } = useWallet();

  if (isRestoringSession) {
    return (
      <div className="route-loading" role="status" aria-live="polite">
        Restoring wallet session...
      </div>
    );
  }

  if (!isConnected) {
    return <Navigate to="/" replace />;
  }

  if (role !== expectedRole) {
    return <Navigate to={workspace?.home || "/"} replace />;
  }

  return (
    <div>
      <nav className="subnav" aria-label={navigationLabel}>
        {links.map(({ end = false, label, to }) => (
          <NavLink key={to} to={to} end={end}>
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
