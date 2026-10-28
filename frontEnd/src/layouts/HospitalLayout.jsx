import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, NavLink, Outlet, useNavigate } from "react-router-dom";
import { getHospitalSession, logoutHospital, readHospitalSession } from "../services/hospitalApi";

export default function HospitalLayout() {
  const [expired, setExpired] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useQuery({ queryKey: ["hospitalSession"], queryFn: getHospitalSession, retry: false, refetchInterval: 60000 });
  useEffect(() => {
    const expire = () => setExpired(true);
    window.addEventListener("blockinsure:hospital-session-expired", expire);
    return () => window.removeEventListener("blockinsure:hospital-session-expired", expire);
  }, []);
  if (expired || !readHospitalSession() || [401, 403].includes(session.error?.response?.status)) return <Navigate to="/hospital/login" replace />;
  if (session.isPending) return <p role="status">Restoring hospital session…</p>;
  if (session.isError) return <section className="page-container"><p role="alert">Hospital session check is unavailable.</p><button onClick={() => session.refetch()}>Retry session check</button></section>;
  const logout = async () => {
    try {
      await logoutHospital();
      queryClient.removeQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("hospital") });
      navigate("/hospital/login", { replace: true });
    } catch { setLogoutError("Sign-out could not be confirmed. Retry to revoke your sessions."); }
  };
  return <div className="workspace-shell" data-role="hospital">
    <div className="workspace-navigation">
      <div className="workspace-identity"><span><small>Hospital staff</small><strong>{session.data.staff.displayName} · {session.data.staff.hospitalId}</strong></span></div>
      <nav className="subnav" aria-label="Hospital navigation">
        <NavLink to="/hospital/dashboard">Overview</NavLink><NavLink to="/hospital/records">Patient &amp; Invoices</NavLink>
        <button type="button" onClick={logout} style={{ minHeight: 44 }}>Sign out all staff sessions</button>
      </nav>
    </div>
    {logoutError && <p role="alert">{logoutError}</p>}
    <Outlet context={{ staff: session.data.staff }} />
  </div>;
}
