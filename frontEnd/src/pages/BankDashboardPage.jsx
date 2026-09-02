import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useWallet } from "../context/useWallet";
import {
  approveBankMandate, getMyBankAccounts, getMyBankMandates, getMyBankProfile,
  getMyBankTransactions, rejectBankMandate, runBankAutomation,
} from "../services/api";
import { showToast } from "../services/toast";
import "../styles/pages/BankDashboardPage.css";

const formatBdt = (value) => Number(value || 0).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const errorMessage = (error) => error.response?.data?.message || error.message;

export default function BankDashboardPage() {
  const { walletAddress } = useWallet();
  const queryClient = useQueryClient();
  const [referenceDate, setReferenceDate] = useState(new Date().toISOString().slice(0, 10));
  const profileQuery = useQuery({ queryKey: ["bankProfile", walletAddress], queryFn: getMyBankProfile });
  const accountsQuery = useQuery({ queryKey: ["bankAccounts", walletAddress], queryFn: getMyBankAccounts });
  const mandatesQuery = useQuery({ queryKey: ["bankMandates", walletAddress], queryFn: getMyBankMandates });
  const transactionsQuery = useQuery({ queryKey: ["bankTransactions", walletAddress], queryFn: getMyBankTransactions });

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["bankProfile"] }),
    queryClient.invalidateQueries({ queryKey: ["bankAccounts"] }),
    queryClient.invalidateQueries({ queryKey: ["bankMandates"] }),
    queryClient.invalidateQueries({ queryKey: ["bankTransactions"] }),
  ]);
  const actionMutation = useMutation({
    mutationFn: ({ type, mandateId }) => type === "approve" ? approveBankMandate(mandateId) : rejectBankMandate(mandateId, "Bank review declined the standing instruction"),
    onSuccess: async (data) => { showToast(data.message, "success"); await refresh(); },
    onError: (error) => showToast(errorMessage(error), "error"),
  });
  const automationMutation = useMutation({
    mutationFn: runBankAutomation,
    onSuccess: async (data) => {
      const result = data.result;
      showToast(`Scan complete: ${result.reminders} reminder(s), ${result.paid} paid, ${result.failed} failed.`, result.failed ? "warning" : "success");
      await refresh();
    },
    onError: (error) => showToast(errorMessage(error), "error"),
  });

  const bank = profileQuery.data?.bank;
  const summary = profileQuery.data?.summary;
  const accounts = accountsQuery.data?.accounts || [];
  const mandates = mandatesQuery.data?.mandates || [];
  const transactions = transactionsQuery.data?.transactions || [];
  const error = profileQuery.error || accountsQuery.error || mandatesQuery.error || transactionsQuery.error;
  const refreshing = profileQuery.isFetching || accountsQuery.isFetching || mandatesQuery.isFetching || transactionsQuery.isFetching;

  return <section className="page-container page-bank-dashboard">
    <div className="bank-heading"><div><span className="dashboard-eyebrow">Independent banking authority</span><h2>{bank?.name || "Bank Workspace"}</h2><p>Approve standing instructions, operate simulated customer balances, and anchor completed premium transfers to the policy ledger.</p></div><button type="button" disabled={refreshing} onClick={refresh}>{refreshing ? "Refreshing..." : "Refresh bank data"}</button></div>
    {error ? <p className="error-text" role="alert">{errorMessage(error)}</p> : null}
    {bank ? <>
      <section className="card bank-identity-card"><div><span>Bank ID</span><strong>{bank.bankId}</strong></div><div><span>Operating status</span><strong>{bank.operatingStatus}</strong></div><div><span>Routing code</span><strong>{bank.routingCode}</strong></div><div><span>Settlement currency</span><strong>{bank.currency}</strong></div><div className="bank-wallet-field"><span>Bank wallet</span><strong>{bank.walletAddress}</strong></div></section>
      <div className="card-row bank-metric-grid"><div className="card"><span>Customer accounts</span><strong>{summary?.accounts || 0}</strong></div><div className="card"><span>Total demo balance</span><strong>{formatBdt(summary?.totalBalance)} BDT</strong></div><div className="card"><span>Pending mandates</span><strong>{summary?.pendingMandates || 0}</strong></div><div className="card"><span>Processed transfers</span><strong>{summary?.transactions || 0}</strong></div></div>
      <section className="card bank-foundation-note"><span className="dashboard-eyebrow">EFT capability</span><h3>Quarterly bank automation active</h3><p>{profileQuery.data?.capabilities?.note}</p><div><span>15–20 day reminders</span><span>Due-date debit without OTP</span><span>Manual payment with OTP</span><span>On-chain confirmation</span></div></section>
    </> : null}

    <section className="card bank-automation-card"><div><h3>Automation clock</h3><p>Use today for normal processing or a future date to demonstrate reminder and due-date behavior.</p></div><div><input aria-label="Automation reference date" type="date" value={referenceDate} onChange={(event) => setReferenceDate(event.target.value)} /><button type="button" disabled={automationMutation.isPending} onClick={() => automationMutation.mutate(referenceDate)}>{automationMutation.isPending ? "Processing..." : "Run reminder and debit scan"}</button></div></section>

    <section className="card bank-accounts-card"><div><h3>Simulated customer accounts</h3><p>Bank-owned balances change only after a confirmed transfer.</p></div>{accounts.length ? <div className="table-wrap"><table><thead><tr><th>Account</th><th>Holder</th><th>Policyholder wallet</th><th>Available balance</th><th>Status</th></tr></thead><tbody>{accounts.map((account) => <tr key={account.accountReference}><td><strong>{account.maskedAccount}</strong><small>{account.accountReference}</small></td><td>{account.accountHolderName}</td><td className="bank-wallet-cell">{account.ownerWalletAddress}</td><td><strong>{formatBdt(account.balance)} {account.currency}</strong></td><td>{account.status}</td></tr>)}</tbody></table></div> : <p>No accounts.</p>}</section>

    <section className="card bank-mandates-card"><h3>EFT mandate queue</h3>{mandates.length ? <div className="table-wrap"><table><thead><tr><th>Policyholder</th><th>Policy</th><th>Account</th><th>Quarterly amount</th><th>Schedule</th><th>Status</th><th>Bank action</th></tr></thead><tbody>{mandates.map((mandate) => <tr key={mandate.mandateId}><td className="bank-wallet-cell">{mandate.ownerWalletAddress}</td><td>#{mandate.policyId}</td><td>{mandate.accountReference}</td><td>{mandate.amount} {mandate.currency}</td><td>{mandate.nextDebitAt ? new Date(mandate.nextDebitAt).toLocaleDateString() : `${new Date(mandate.validFrom).toLocaleDateString()} start`}</td><td>{mandate.status.replaceAll("_", " ")}</td><td>{mandate.status === "PENDING_BANK_APPROVAL" ? <div className="bank-action-row"><button type="button" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate({ type: "approve", mandateId: mandate.mandateId })}>Approve</button><button type="button" className="button-secondary" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate({ type: "reject", mandateId: mandate.mandateId })}>Reject</button></div> : "—"}</td></tr>)}</tbody></table></div> : <p>No standing instructions are awaiting review.</p>}</section>

    <section className="card"><h3>Transfer ledger</h3>{transactions.length ? <div className="table-wrap"><table><thead><tr><th>Completed</th><th>Policy</th><th>Method</th><th>Amount</th><th>Status</th><th>Chain transaction</th></tr></thead><tbody>{transactions.map((item) => <tr key={item.transactionId}><td>{new Date(item.completedAt || item.dueAt).toLocaleString()}</td><td>#{item.policyId}</td><td>{item.type === "EFT" ? "Automatic EFT" : "Manual OTP"}</td><td>{item.amount} {item.currency}</td><td>{item.status}{item.failureReason ? <small>{item.failureReason}</small> : null}</td><td className="bank-wallet-cell">{item.transactionHash || "—"}</td></tr>)}</tbody></table></div> : <p>No transfer attempts yet.</p>}</section>
  </section>;
}
