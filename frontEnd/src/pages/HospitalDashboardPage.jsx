import { useQuery } from "@tanstack/react-query";

import { useWallet } from "../context/useWallet";
import { getMyHospitalProfile, getMyHospitalRecords } from "../services/api";
import { formatDateOnly } from "../utils/dateFormat";
import "../styles/pages/HospitalDashboardPage.css";

export default function HospitalDashboardPage() {
  const { walletAddress } = useWallet();
  const profileQuery = useQuery({
    queryKey: ["hospitalProfile", walletAddress],
    queryFn: getMyHospitalProfile,
  });
  const recordsQuery = useQuery({
    queryKey: ["hospitalRecords", walletAddress],
    queryFn: () => getMyHospitalRecords({ limit: 100 }),
  });

  const hospital = profileQuery.data?.hospital;
  const summary = profileQuery.data?.summary;
  const records = recordsQuery.data?.records || [];
  const error = profileQuery.error || recordsQuery.error;
  const refreshing = profileQuery.isFetching || recordsQuery.isFetching;

  return (
    <section className="page-container page-hospital-dashboard">
      <div className="hospital-heading">
        <div>
          <span className="dashboard-eyebrow">Independent provider workspace</span>
          <h2>{hospital?.name || "Hospital Workspace"}</h2>
          <p>
            This view is scoped to the connected hospital wallet and its own
            patient and invoice records.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            profileQuery.refetch();
            recordsQuery.refetch();
          }}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing..." : "Refresh hospital data"}
        </button>
      </div>

      {error ? (
        <p className="error-text" role="alert">
          {error.response?.data?.message || error.message || "Hospital data is unavailable"}
        </p>
      ) : null}
      {profileQuery.isLoading ? <p>Loading hospital identity...</p> : null}

      {hospital ? (
        <>
          <section className="card hospital-identity-card">
            <div><span>Hospital ID</span><strong>{hospital.hospitalId}</strong></div>
            <div><span>Network status</span><strong>{hospital.networkStatus}</strong></div>
            <div><span>Location</span><strong>{hospital.district}, {hospital.division}</strong></div>
            <div><span>Provider tier</span><strong>{hospital.hospitalTier}</strong></div>
            <div className="hospital-wallet-field">
              <span>Hospital wallet</span><strong>{hospital.walletAddress}</strong>
            </div>
          </section>

          <div className="card-row hospital-metric-grid">
            <div className="card"><span>Owned records</span><strong>{summary?.totalRecords || 0}</strong></div>
            <div className="card"><span>Valid invoices</span><strong>{summary?.validRecords || 0}</strong></div>
            <div className="card"><span>Used invoices</span><strong>{summary?.usedRecords || 0}</strong></div>
            <div className="card"><span>Cancelled</span><strong>{summary?.cancelledRecords || 0}</strong></div>
          </div>

          <section className="card hospital-foundation-note">
            <span className="dashboard-eyebrow">Provider workflow status</span>
            <h3>Independent hospital verification active</h3>
            <p>{profileQuery.data?.capabilities?.note}</p>
            <div>
              <span>View owned records: Enabled</span>
              <span>Record maintenance: Enabled</span>
              <span>Claim verification: On-chain hospital attestation</span>
            </div>
          </section>
        </>
      ) : null}

      <section className="card hospital-records-card">
        <div>
          <h3>Hospital-owned invoice records</h3>
          <p>Insurer-wide registry data is not exposed in this workspace.</p>
        </div>
        {recordsQuery.isLoading ? <p>Loading records...</p> : null}
        {!recordsQuery.isLoading && records.length === 0 ? <p>No records are assigned to this hospital.</p> : null}
        {records.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Patient reference</th><th>Invoice</th><th>Treatment</th><th>Care dates</th><th>Bill</th><th>Status</th></tr></thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id || record.invoiceHash}>
                    <td className="hospital-record-hash">{record.patientHash}</td>
                    <td><strong>{record.invoiceNumber}</strong><small>{record.invoiceHash}</small></td>
                    <td>{record.treatmentType}<small>{record.diagnosisCode}</small></td>
                    <td>{formatDateOnly(record.admissionDate)}<small>to {formatDateOnly(record.dischargeDate)}</small></td>
                    <td>{record.billAmount} ETH</td>
                    <td><strong>{record.recordStatus}</strong><small>{record.invoiceStatus}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </section>
  );
}
