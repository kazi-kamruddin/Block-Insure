import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { useWallet } from "../context/useWallet";
import {
  cancelEftMandate, confirmManualBankPayment, createEftMandate,
  getMyBankingAccounts, getMyBankingTransactions, getMyEftMandates,
  getMyPolicies, requestManualBankPaymentOtp,
} from "../services/api";
import { showToast } from "../services/toast";
import "../styles/pages/BankingPage.css";

const dateInput = (date) => new Date(date).toISOString().slice(0, 10);
const addYear = (date) => {
  const next = new Date(date);
  next.setUTCFullYear(next.getUTCFullYear() + 1);
  return dateInput(next);
};
const messageOf = (error) => error.response?.data?.message || error.message;

export default function BankingPage() {
  const { walletAddress } = useWallet();
  const queryClient = useQueryClient();
  const [accountReference, setAccountReference] = useState("");
  const [policyId, setPolicyId] = useState("");
  const [validFrom, setValidFrom] = useState(dateInput(new Date()));
  const [validUntil, setValidUntil] = useState(addYear(new Date()));
  const [otpState, setOtpState] = useState(null);
  const [otp, setOtp] = useState("");

  const accountsQuery = useQuery({ queryKey: ["myBankingAccounts", walletAddress], queryFn: getMyBankingAccounts });
  const policiesQuery = useQuery({ queryKey: ["bankingPolicies", walletAddress], queryFn: () => getMyPolicies({ limit: 100 }) });
  const mandatesQuery = useQuery({ queryKey: ["myEftMandates", walletAddress], queryFn: getMyEftMandates });
  const transactionsQuery = useQuery({ queryKey: ["myBankingTransactions", walletAddress], queryFn: getMyBankingTransactions });

  const accounts = accountsQuery.data?.accounts || [];
  const policies = useMemo(() => (policiesQuery.data?.policies || []).filter((policy) => ["ACTIVE", "GRACE_PERIOD"].includes(policy.status?.label)), [policiesQuery.data]);
  const mandates = mandatesQuery.data?.mandates || [];
  const transactions = transactionsQuery.data?.transactions || [];
  const selectedPolicy = policies.find((policy) => policy.policyId === policyId);

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["myBankingAccounts"] }),
    queryClient.invalidateQueries({ queryKey: ["myEftMandates"] }),
    queryClient.invalidateQueries({ queryKey: ["myBankingTransactions"] }),
    queryClient.invalidateQueries({ queryKey: ["myPayments"] }),
  ]);

  const mandateMutation = useMutation({
    mutationFn: createEftMandate,
    onSuccess: async (data) => { showToast(data.message, "success"); await refresh(); },
    onError: (error) => showToast(messageOf(error), "error"),
  });
  const cancelMutation = useMutation({
    mutationFn: cancelEftMandate,
    onSuccess: async (data) => { showToast(data.message, "success"); await refresh(); },
    onError: (error) => showToast(messageOf(error), "error"),
  });
  const otpRequestMutation = useMutation({
    mutationFn: requestManualBankPaymentOtp,
    onSuccess: (data) => { setOtpState(data); setOtp(data.demoOtp || ""); showToast(data.deliveryMessage, "success"); },
    onError: (error) => showToast(messageOf(error), "error"),
  });
  const otpConfirmMutation = useMutation({
    mutationFn: confirmManualBankPayment,
    onSuccess: async (data) => { setOtpState(null); setOtp(""); showToast(data.message, "success"); await refresh(); },
    onError: (error) => showToast(messageOf(error), "error"),
  });

  const submitMandate = (event) => {
    event.preventDefault();
    mandateMutation.mutate({ accountReference, policyId, validFrom, validUntil });
  };
  const requestOtp = () => otpRequestMutation.mutate({ accountReference, policyId });

  return <section className="page-container banking-page">
    <header className="banking-hero">
      <span className="dashboard-eyebrow">Policyholder banking</span>
      <h2>Premium payments and standing EFT instructions</h2>
      <p>Quarterly EFT runs automatically after bank approval and never asks for OTP. OTP is required only when you initiate a manual bank payment.</p>
    </header>

    <div className="banking-grid">
      <form className="card banking-form" onSubmit={submitMandate}>
        <h3>Set up quarterly EFT</h3>
        <label>Source account<select required value={accountReference} onChange={(event) => setAccountReference(event.target.value)}>
          <option value="">Choose an account</option>{accounts.map((account) => <option key={account.accountReference} value={account.accountReference}>{account.maskedAccount} — {account.balance} BDT</option>)}
        </select></label>
        <label>Policy<select required value={policyId} onChange={(event) => {
          const id = event.target.value; setPolicyId(id);
          const policy = policies.find((item) => item.policyId === id);
          if (policy?.nextPremiumDueDate && Number(policy.nextPremiumDueDate) > 0) setValidFrom(dateInput(Number(policy.nextPremiumDueDate) * 1000));
        }}><option value="">Choose a policy</option>{policies.map((policy) => <option key={policy.policyId} value={policy.policyId}>#{policy.policyId} {policy.packageName} — {policy.premiumAmountEth} ETH</option>)}</select></label>
        <div className="banking-date-grid"><label>Start date<input type="date" required value={validFrom} onChange={(event) => setValidFrom(event.target.value)} /></label><label>End date<input type="date" required value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></label></div>
        <div className="eft-summary"><span>Destination</span><strong>Block-Insure premium treasury</strong><span>Frequency</span><strong>Every 90 days</strong><span>Premium</span><strong>{selectedPolicy?.premiumAmountEth || "—"} ETH / bank BDT equivalent</strong></div>
        <button type="submit" disabled={mandateMutation.isPending || !accounts.length}>{mandateMutation.isPending ? "Submitting..." : "Send mandate to bank"}</button>
        <button type="button" className="button-secondary" disabled={!accountReference || !policyId || otpRequestMutation.isPending} onClick={requestOtp}>{otpRequestMutation.isPending ? "Issuing OTP..." : "Make a manual bank payment"}</button>
        {otpState ? <div className="otp-box"><p>OTP expires at {new Date(otpState.expiresAt).toLocaleTimeString()}. {otpState.demoOtp ? "Demo mode prefilled the issued OTP." : "Enter the OTP delivered by the bank."}</p><input aria-label="Bank payment OTP" inputMode="numeric" maxLength="6" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))} /><button type="button" disabled={otp.length !== 6 || otpConfirmMutation.isPending} onClick={() => otpConfirmMutation.mutate({ challengeId: otpState.challengeId, otp })}>{otpConfirmMutation.isPending ? "Confirming..." : "Confirm manual payment"}</button></div> : null}
      </form>

      <section className="card"><h3>My bank accounts</h3>{accounts.length ? accounts.map((account) => <article className="bank-account-row" key={account.accountReference}><div><strong>{account.maskedAccount}</strong><small>{account.accountHolderName}</small></div><strong>{account.balance} {account.currency}</strong></article>) : <p>No simulated bank account is linked to this wallet.</p>}</section>
    </div>

    <section className="card"><h3>Standing instructions</h3>{mandates.length ? <div className="table-wrap"><table><thead><tr><th>Policy</th><th>Account</th><th>Amount</th><th>Next debit</th><th>Status</th><th>Action</th></tr></thead><tbody>{mandates.map((mandate) => <tr key={mandate.mandateId}><td>#{mandate.policyId}</td><td>{mandate.accountReference}</td><td>{mandate.amount} {mandate.currency}</td><td>{mandate.nextDebitAt ? new Date(mandate.nextDebitAt).toLocaleDateString() : "After bank approval"}</td><td>{mandate.status.replaceAll("_", " ")}</td><td>{["ACTIVE", "PENDING_BANK_APPROVAL"].includes(mandate.status) ? <button type="button" className="button-link" onClick={() => cancelMutation.mutate(mandate.mandateId)}>Cancel</button> : "—"}</td></tr>)}</tbody></table></div> : <p>No EFT mandates yet.</p>}</section>

    <section className="card"><h3>Bank transfer activity</h3>{transactions.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Policy</th><th>Method</th><th>Amount</th><th>Status</th><th>Reference</th></tr></thead><tbody>{transactions.map((item) => <tr key={item.transactionId}><td>{new Date(item.completedAt || item.dueAt).toLocaleString()}</td><td>#{item.policyId}</td><td>{item.type === "EFT" ? "Quarterly EFT" : "Manual OTP"}</td><td>{item.amount} {item.currency}</td><td>{item.status}</td><td><small>{item.transactionId}</small></td></tr>)}</tbody></table></div> : <p>No bank transfers have been processed.</p>}</section>
  </section>;
}
