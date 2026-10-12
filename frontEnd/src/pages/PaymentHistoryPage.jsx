import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import TransactionLink from "../components/TransactionLink";
import { useWallet } from "../context/useWallet";
import {
  downloadInsuranceCertificate,
  downloadPremiumStatement,
  getMyPaymentStatement,
  getMyPolicies,
} from "../services/api";
import { showToast } from "../services/toast";
import { formatDateOnly, formatDateTime } from "../utils/dateFormat";
import "../styles/pages/PaymentHistoryPage.css";

function extractPolicies(data) {
  if (Array.isArray(data?.policies)) return data.policies;
  return [];
}

function saveDownload({ blob, filename }) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function PaymentHistoryPage() {
  const { isConnected, walletAddress } = useWallet();
  const [searchParams, setSearchParams] = useSearchParams();
  const [policyId, setPolicyId] = useState(searchParams.get("policyId") || "");
  const [fiscalYear, setFiscalYear] = useState("");
  const [downloading, setDownloading] = useState("");

  const policiesQuery = useQuery({
    queryKey: ["paymentHistoryPolicies", walletAddress],
    queryFn: () => getMyPolicies({ limit: 100 }),
    enabled: isConnected,
  });
  const statementQuery = useQuery({
    queryKey: ["paymentStatement", walletAddress, policyId, fiscalYear],
    queryFn: () =>
      getMyPaymentStatement({
        ...(policyId ? { policyId } : {}),
        ...(fiscalYear ? { fiscalYear } : {}),
      }),
    enabled: isConnected,
  });

  const allPolicies = extractPolicies(policiesQuery.data);
  const statement = statementQuery.data;
  const selectedFiscalYear = fiscalYear || statement?.fiscalYear?.label || "";

  function changePolicy(nextPolicyId) {
    setPolicyId(nextPolicyId);
    const next = new URLSearchParams(searchParams);
    if (nextPolicyId) next.set("policyId", nextPolicyId);
    else next.delete("policyId");
    setSearchParams(next, { replace: true });
  }

  async function runDownload(key, action) {
    setDownloading(key);
    try {
      saveDownload(await action());
      showToast("Report downloaded successfully.", { title: "Download ready" });
    } catch (error) {
      showToast(error.response?.data?.message || error.message || "Download failed", {
        tone: "error",
        title: "Could not download report",
      });
    } finally {
      setDownloading("");
    }
  }

  return (
    <section className="page-container page-payment-history">
      <div className="payment-page-heading">
        <div>
          <span className="dashboard-eyebrow">Premium records</span>
          <h2>Payments and Statements</h2>
          <p>
            Review confirmed payments, upcoming installments, and July–June
            fiscal-year reports.
          </p>
        </div>
        <button
          type="button"
          onClick={() => statementQuery.refetch()}
          disabled={statementQuery.isFetching}
        >
          {statementQuery.isFetching ? "Refreshing..." : "Refresh ledger"}
        </button>
      </div>

      <div className="card payment-filters">
        <label>
          Policy
          <select value={policyId} onChange={(event) => changePolicy(event.target.value)}>
            <option value="">All policies</option>
            {allPolicies.map((policy) => (
              <option value={policy.policyId} key={policy.policyId}>
                Policy #{policy.policyId} — {policy.packageName || `Package ${policy.packageId}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Bangladesh fiscal year (July–June)
          <select
            value={selectedFiscalYear}
            onChange={(event) => setFiscalYear(event.target.value)}
          >
            {(statement?.availableFiscalYears || []).map((year) => (
              <option value={year.label} key={year.label}>{year.label}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() =>
            runDownload("statement", () =>
              downloadPremiumStatement({
                ...(policyId ? { policyId } : {}),
                ...(selectedFiscalYear ? { fiscalYear: selectedFiscalYear } : {}),
              })
            )
          }
          disabled={!statement || downloading === "statement"}
        >
          {downloading === "statement" ? "Preparing..." : "Download Tax Statement (.csv)"}
        </button>
      </div>

      {statementQuery.isLoading ? <p>Loading payment ledger...</p> : null}
      {statementQuery.error ? (
        <p className="error-text" role="alert">
          {statementQuery.error.response?.data?.message ||
            statementQuery.error.message ||
            "Could not load payment history"}
        </p>
      ) : null}

      {statement ? (
        <>
          <div className="card-row payment-summary-grid">
            <div className="card">
              <span>Fiscal-year payments</span>
              <strong>{statement.summary.paymentCount}</strong>
            </div>
            <div className="card">
              <span>Total paid</span>
              <strong>{statement.summary.totalPaidEth} ETH</strong>
            </div>
            <div className="card">
              <span>Policies represented</span>
              <strong>{statement.summary.policiesCovered}</strong>
            </div>
            <div className="card">
              <span>Statement period</span>
              <strong>{statement.fiscalYear.label}</strong>
              <small>{formatDateOnly(statement.fiscalYear.startDate)} – {formatDateOnly(statement.fiscalYear.endDate)}</small>
            </div>
          </div>

          <section className="card payment-ledger-card">
            <div>
              <h3>Premium payment ledger</h3>
              <p>Paid entries are reconstructed from confirmed smart-contract events.</p>
            </div>
            {statement.payments.length === 0 ? (
              <p>No confirmed payments fall inside this fiscal year.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Policy / plan</th>
                      <th>Purpose</th>
                      <th>Method</th>
                      <th>Status</th>
                      <th>Amount</th>
                      <th>Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.payments.map((payment) => (
                      <tr key={payment.paymentId}>
                        <td>{formatDateTime(payment.paidAt)}</td>
                        <td>#{payment.policyId}<small>{payment.planName}</small></td>
                        <td>{payment.purposeLabel}</td>
                        <td>{payment.paymentMethodLabel}</td>
                        <td><span className="payment-status is-paid">{payment.status}</span></td>
                        <td>{payment.amountEth} ETH</td>
                        <td><TransactionLink txHash={payment.transactionHash} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card scheduled-payments-card">
            <h3>Upcoming installments</h3>
            {statement.upcomingPayments.length === 0 ? (
              <p>No installment is scheduled inside the selected fiscal year.</p>
            ) : (
              <div className="scheduled-payment-list">
                {statement.upcomingPayments.map((payment) => (
                  <div key={`${payment.policyId}:${payment.dueAt}`}>
                    <div>
                      <strong>Policy #{payment.policyId} — {payment.planName}</strong>
                      <span>Due {formatDateOnly(payment.dueAt)}</span>
                    </div>
                    <strong>{payment.amountEth} ETH</strong>
                    <span className="payment-status is-scheduled">{payment.status}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="certificate-list">
            <div>
              <h3>Certificates of Insurance</h3>
              <p>Each certificate includes policy identity, plan, face value, dates, schedule, and paid-to-date totals.</p>
            </div>
            <div className="card-row">
              {statement.policies.map((policy) => (
                <article className="card certificate-card" key={policy.policyId}>
                  <span className="dashboard-eyebrow">Policy #{policy.policyId}</span>
                  <h3>{policy.planName}</h3>
                  <p>Face value: {policy.faceValueEth} ETH</p>
                  <p>Paid to date: {policy.totalPremiumPaidEth} ETH</p>
                  <button
                    type="button"
                    onClick={() =>
                      runDownload(`certificate-${policy.policyId}`, () =>
                        downloadInsuranceCertificate(policy.policyId, {
                          fiscalYear: selectedFiscalYear,
                        })
                      )
                    }
                    disabled={downloading === `certificate-${policy.policyId}`}
                  >
                    {downloading === `certificate-${policy.policyId}`
                      ? "Preparing..."
                      : "Download Certificate (.html)"}
                  </button>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}
