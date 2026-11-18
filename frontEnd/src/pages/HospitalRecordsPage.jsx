import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createMyHospitalRecord,
  getMyHospitalRecords,
  updateMyHospitalRecord,
} from "../services/api";
import { formatDateOnly } from "../utils/dateFormat";
import { showToast } from "../services/toast";
import "../styles/pages/HospitalDashboardPage.css";

const emptyForm = {
  patientReference: "",
  patientContact: "",
  invoiceNumber: "",
  treatmentType: "HOSPITALIZATION",
  diagnosisCode: "",
  admissionDate: "",
  dischargeDate: "",
  invoiceDate: "",
  billAmount: "",
};

export default function HospitalRecordsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const recordsQuery = useQuery({
    queryKey: ["hospitalRecords", "maintenance"],
    queryFn: () => getMyHospitalRecords({ limit: 100 }),
    refetchInterval: (query) => query.state.data?.records?.some((record) => record.publicationPending) ? 3000 : false,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["hospitalRecords"] });
  const createMutation = useMutation({
    mutationFn: createMyHospitalRecord,
    onSuccess: (result) => {
      setForm(emptyForm);
      refresh();
      showToast(result.message, { title: "Hospital record created" });
    },
  });
  const statusMutation = useMutation({
    mutationFn: ({ id, updates }) => updateMyHospitalRecord(id, updates),
    onSuccess: (result) => {
      refresh();
      showToast(result.message, { title: "Hospital record updated" });
    },
  });
  const records = recordsQuery.data?.records || [];
  const error = createMutation.error || statusMutation.error || recordsQuery.error;

  const updateField = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event) => {
    event.preventDefault();
    createMutation.mutate(form);
  };

  return (
    <section className="page-container page-hospital-dashboard">
      <div className="hospital-heading">
        <div>
          <span className="dashboard-eyebrow">Hospital-owned data</span>
          <h2>Patient and Invoice Records</h2>
          <p>Only authorized staff assigned to this hospital can maintain these source records.</p>
        </div>
      </div>

      {error ? <p className="error-text" role="alert">{error.response?.data?.message || error.message}</p> : null}

      <form className="card form-grid hospital-record-form" onSubmit={submit}>
        <h3>Create hospital record</h3>
        <label>Patient reference<input value={form.patientReference} onChange={(e) => updateField("patientReference", e.target.value)} required /><small>Stored as a hospital-scoped hash. Equal local references at other hospitals are separate people.</small></label>
        <label>Patient contact email (if recorded)<input type="email" value={form.patientContact} onChange={e => updateField("patientContact", e.target.value)} /></label>
        <label>Invoice number<input value={form.invoiceNumber} onChange={(e) => updateField("invoiceNumber", e.target.value)} required /></label>
        <label>Treatment type<input value={form.treatmentType} onChange={(e) => updateField("treatmentType", e.target.value)} required /></label>
        <label>Diagnosis code<input value={form.diagnosisCode} onChange={(e) => updateField("diagnosisCode", e.target.value)} required /></label>
        <label>Admission date<input type="date" value={form.admissionDate} onChange={(e) => updateField("admissionDate", e.target.value)} required /></label>
        <label>Discharge date<input type="date" value={form.dischargeDate} onChange={(e) => updateField("dischargeDate", e.target.value)} required /></label>
        <label>Invoice date<input type="date" value={form.invoiceDate} onChange={(e) => updateField("invoiceDate", e.target.value)} required /></label>
        <label>Bill amount (ETH)<input type="number" min="0.000000000000000001" step="any" value={form.billAmount} onChange={(e) => updateField("billAmount", e.target.value)} required /></label>
        <button type="submit" disabled={createMutation.isPending}>{createMutation.isPending ? "Creating..." : "Create hospital record"}</button>
        <p className="muted-text">Record changes queue automatic publication. Oracle verification uses a confirmed immutable snapshot.</p>
      </form>

      <section className="card hospital-records-card">
        <h3>Owned records</h3>
        {recordsQuery.isLoading ? <p>Loading records...</p> : null}
        {records.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Invoice</th><th>Patient hash</th><th>Care</th><th>Bill</th><th>Correction</th></tr></thead>
            <tbody>{records.map((record) => (
              <tr key={record.id}>
                <td><strong>{record.invoiceNumber}</strong><small>{record.invoiceHash}</small>{record.publicationPending ? <small>Publication pending</small> : <small>Ready for the latest registry publication</small>}</td>
                <td className="hospital-record-hash">{record.patientHash}</td>
                <td>{record.treatmentType}<small>{formatDateOnly(record.admissionDate)} to {formatDateOnly(record.dischargeDate)}</small></td>
                <td>{record.billAmount} ETH</td>
                <td><form onSubmit={event => {
                  event.preventDefault();
                  statusMutation.mutate({ id: record.id, updates: { billAmount: new FormData(event.currentTarget).get("amount") } });
                }}><input aria-label={`Correct bill for ${record.invoiceNumber}`} name="amount" defaultValue={record.billAmount} type="number" step="any" min="0.000000000000000001" required /><button disabled={statusMutation.isPending}>Save correction</button></form></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : !recordsQuery.isLoading ? <p>No hospital records found.</p> : null}
      </section>
    </section>
  );
}
