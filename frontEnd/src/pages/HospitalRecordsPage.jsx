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
          <p>Only this hospital wallet can add or maintain these source records.</p>
        </div>
      </div>

      {error ? <p className="error-text" role="alert">{error.response?.data?.message || error.message}</p> : null}

      <form className="card form-grid hospital-record-form" onSubmit={submit}>
        <h3>Create hospital record</h3>
        <label>Patient reference<input value={form.patientReference} onChange={(e) => updateField("patientReference", e.target.value)} required /><small>The server stores a one-way hash, not the entered reference.</small></label>
        <label>Invoice number<input value={form.invoiceNumber} onChange={(e) => updateField("invoiceNumber", e.target.value)} required /></label>
        <label>Treatment type<input value={form.treatmentType} onChange={(e) => updateField("treatmentType", e.target.value)} required /></label>
        <label>Diagnosis code<input value={form.diagnosisCode} onChange={(e) => updateField("diagnosisCode", e.target.value)} required /></label>
        <label>Admission date<input type="date" value={form.admissionDate} onChange={(e) => updateField("admissionDate", e.target.value)} required /></label>
        <label>Discharge date<input type="date" value={form.dischargeDate} onChange={(e) => updateField("dischargeDate", e.target.value)} required /></label>
        <label>Invoice date<input type="date" value={form.invoiceDate} onChange={(e) => updateField("invoiceDate", e.target.value)} required /></label>
        <label>Bill amount (ETH)<input type="number" min="0.001" step="0.001" value={form.billAmount} onChange={(e) => updateField("billAmount", e.target.value)} required /></label>
        <button type="submit" disabled={createMutation.isPending}>{createMutation.isPending ? "Creating..." : "Create hospital record"}</button>
        <p className="muted-text">Record changes require the insurer to publish a refreshed registry commitment before oracle verification.</p>
      </form>

      <section className="card hospital-records-card">
        <h3>Owned records</h3>
        {recordsQuery.isLoading ? <p>Loading records...</p> : null}
        {records.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Invoice</th><th>Patient hash</th><th>Care</th><th>Bill</th><th>Record</th><th>Invoice status</th></tr></thead>
            <tbody>{records.map((record) => (
              <tr key={record.id}>
                <td><strong>{record.invoiceNumber}</strong><small>{record.invoiceHash}</small></td>
                <td className="hospital-record-hash">{record.patientHash}</td>
                <td>{record.treatmentType}<small>{formatDateOnly(record.admissionDate)} to {formatDateOnly(record.dischargeDate)}</small></td>
                <td>{record.billAmount} ETH</td>
                <td><select aria-label={`Record status for ${record.invoiceNumber}`} value={record.recordStatus} onChange={(e) => statusMutation.mutate({ id: record.id, updates: { recordStatus: e.target.value } })}><option>VALID</option><option>INVALID</option><option>USED</option><option>CANCELLED</option></select></td>
                <td><select aria-label={`Invoice status for ${record.invoiceNumber}`} value={record.invoiceStatus} onChange={(e) => statusMutation.mutate({ id: record.id, updates: { invoiceStatus: e.target.value } })}><option>VALID</option><option>USED</option><option>CANCELLED</option><option>SUSPICIOUS</option></select></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : !recordsQuery.isLoading ? <p>No hospital records found.</p> : null}
      </section>
    </section>
  );
}
