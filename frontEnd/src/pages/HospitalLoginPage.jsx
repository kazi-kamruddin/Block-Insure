import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { loginHospital } from "../services/hospitalApi";

export default function HospitalLoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const submit = async (event) => {
    event.preventDefault(); setPending(true); setError("");
    try {
      await loginHospital({ username, password });
      setPassword("");
      queryClient.removeQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("hospital") });
      navigate("/hospital/dashboard", { replace: true });
    } catch (failure) { setError(failure.response?.data?.message || "Hospital sign-in is unavailable. Try again."); }
    finally { setPending(false); }
  };
  return (
    <section className="page-container max-w-xl!">
      <div className="mb-4">
        <span className="dashboard-eyebrow">Provider portal</span>
        <h1>Hospital staff sign-in</h1>
        <p>Use the account assigned by your insurer administrator. A wallet extension is unnecessary.</p>
      </div>
      <form className="card form-grid max-w-none!" onSubmit={submit} aria-busy={pending}>
        <label>Username<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} maxLength={64} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} maxLength={128} required /></label>
        {error && <p role="alert" className="error-text">{error}</p>}
        <button type="submit" disabled={pending} className="min-h-11">{pending ? "Signing in…" : "Sign in to hospital"}</button>
      </form>
      <p className="muted-text mt-3">Sessions expire after two hours. Contact your administrator for a password reset or access change.</p>
    </section>
  );
}
