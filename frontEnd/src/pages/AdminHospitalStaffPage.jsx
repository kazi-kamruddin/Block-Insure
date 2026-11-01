import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getNetworkHospitals } from "../services/api";

export default function AdminHospitalStaffPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ username: "", displayName: "", hospitalId: "", password: "" });
  const [resetId, setResetId] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [message, setMessage] = useState("");
  const hospitals = useQuery({ queryKey: ["networkHospitals"], queryFn: getNetworkHospitals });
  const accounts = useQuery({ queryKey: ["adminHospitalStaff"], queryFn: async () => (await api.get("/api/hospital-staff/accounts")).data });
  const mutate = useMutation({
    mutationFn: async ({ id, payload }) => id ? api.patch(`/api/hospital-staff/accounts/${id}`, payload) : api.post("/api/hospital-staff/accounts", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminHospitalStaff"] });
      setForm((current) => ({ ...current, password: "" })); setResetId(""); setResetPassword("");
      setMessage("Staff access saved. Resets and status changes revoke existing staff sessions.");
    },
  });
  const change = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const error = mutate.error || accounts.error || hospitals.error;
  return <section className="page-container">
    <h1>Hospital staff accounts</h1>
    <p>Provision ordinary staff access to a contracted hospital. These accounts can maintain their own hospital records and have no wallet, voting or insurer privileges.</p>
    {error && <p role="alert" className="error-text">{error.response?.data?.message || error.message}</p>}
    {message && <p role="status">{message}</p>}
    <form className="card form-grid" onSubmit={(event) => { event.preventDefault(); setMessage(""); mutate.mutate({ payload: form }); }}>
      <h2>Provision staff member</h2>
      <label>Hospital<select aria-label="Hospital" required value={form.hospitalId} onChange={(event) => change("hospitalId", event.target.value)}>
        <option value="">Select contracted hospital</option>
        {(hospitals.data?.hospitals || []).filter((hospital) => hospital.networkStatus === "CONTRACTED").map((hospital) =>
          <option key={hospital.hospitalId} value={hospital.hospitalId}>{hospital.hospitalId} · {hospital.name}</option>)}
      </select></label>
      <label>Staff display name<input required maxLength={100} value={form.displayName} onChange={(event) => change("displayName", event.target.value)} /></label>
      <label>Staff username<input required pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,63}" autoComplete="off" value={form.username} onChange={(event) => change("username", event.target.value)} /></label>
      <label>Initial staff password<input required type="password" autoComplete="new-password" minLength={12} maxLength={128} value={form.password} onChange={(event) => change("password", event.target.value)} /></label>
      <button disabled={mutate.isPending} type="submit" style={{ minHeight: 44 }}>Create staff account</button>
      <p>Share credentials privately. Do not put passwords in project documentation or Git.</p>
    </form>
    <section className="card"><h2>Assigned staff</h2>
      {accounts.isLoading && <p role="status">Loading staff accounts…</p>}
      <div className="table-wrap"><table><thead><tr><th>Staff member</th><th>Hospital</th><th>Access</th><th>Actions</th></tr></thead><tbody>
        {(accounts.data?.staff || []).map((staff) => <tr key={staff.staffId}>
          <td>{staff.displayName}<small>{staff.username}</small></td><td>{staff.hospitalId}</td><td>{staff.active ? "Active" : "Disabled"}</td>
          <td><button disabled={mutate.isPending} style={{ minHeight: 44 }} onClick={() => mutate.mutate({ id: staff.staffId, payload: { active: !staff.active } })}>{staff.active ? "Disable" : "Enable"} {staff.username}</button>
            <button style={{ minHeight: 44 }} onClick={() => { setResetId(staff.staffId); setResetPassword(""); }}>Reset password for {staff.username}</button></td>
        </tr>)}
      </tbody></table></div>
      {resetId && <form className="form-grid" onSubmit={(event) => { event.preventDefault(); mutate.mutate({ id: resetId, payload: { password: resetPassword } }); }}>
        <label>New staff password<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} /></label>
        <button type="submit" disabled={mutate.isPending} style={{ minHeight: 44 }}>Save password reset</button>
        <button type="button" onClick={() => { setResetId(""); setResetPassword(""); }}>Cancel reset</button>
      </form>}
    </section>
  </section>;
}
