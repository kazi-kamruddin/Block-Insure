import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ethers } from "ethers";
import { downloadPolicyTerms, getPolicyBenefits } from "../services/api";
import { cancelPolicy, parseTransactionError, requestPolicyBenefit, withdrawPolicyBenefit } from "../services/contractService";
import { showToast } from "../services/toast";
import TransactionLink from "./TransactionLink";
import "../styles/components/PolicyBenefitsPanel.css";

export default function PolicyBenefitsPanel({ policy, onPolicyChanged }) {
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");
  const { data, error: loadError, refetch } = useQuery({ queryKey: ["policyBenefits", policy.policyId], queryFn: () => getPolicyBenefits(policy.policyId), retry: false, refetchInterval: 5000 });
  async function run(action, message) {
    setActing(true); setError("");
    try { await (await action()).wait(); showToast(message); await refetch(); await onPolicyChanged?.(); }
    catch (failure) { setError(parseTransactionError(failure)); }
    finally { setActing(false); }
  }
  if (loadError) return <details className="policy-benefits-panel"><summary>Cancellation refund</summary><p role="alert">Refund schedule is unavailable. Retry after service recovery.</p><button type="button" onClick={() => refetch()}>Retry refund schedule</button></details>;
  if (!data) return <p role="status">Loading cancellation refund schedule…</p>;
  const { terms, projections, requests } = data;
  const latest = requests.filter((request) => request.benefitType.label === "SURRENDER").at(-1);
  const eligible = Number(policy.installmentsPaid || 0) >= terms.minimumSurrenderInstallments;
  const status = policy.status?.label;
  const retryable = !latest || latest.status.label === "REJECTED";
  return <details className="policy-benefits-panel min-w-0 break-words"><summary>Cancellation refund</summary>
    {!terms.configured || !terms.surrenderEnabled ? <p>This policy does not offer a cancellation refund.</p> : <>
      <p>Optional refund: {terms.surrenderValuePercent}% of premiums actually paid after at least {terms.minimumSurrenderInstallments} installments, cancellation and insurer review. Estimated amount: {projections.surrender.eth} test ETH.</p>
      <p>This is a fixed contractual refund, not a savings return or an actuarial calculation of unused premium. It uses a separately funded reserve. Resolve pending medical claims before refund allocation; existing allocated withdrawals remain payable.</p>
      <p>Accepted terms: {data.acceptedTermsVersion || "not yet accepted"}. Requesting the refund binds the published optional schedule; it does not change the original medical policy document.</p>
      <button type="button" onClick={() => downloadPolicyTerms(policy.policyId).catch((failure) => setError(failure.message))}>Download policy terms</button>
      {!eligible && <p>Paid installments: {policy.installmentsPaid || 0}/{terms.minimumSurrenderInstallments}. Extra immediate premiums cannot accelerate eligibility.</p>}
      {eligible && retryable && ["ACTIVE", "GRACE_PERIOD", "LAPSED"].includes(status) && <button type="button" disabled={acting} onClick={() => {
        if (window.confirm("Cancel this policy? Cancellation ends coverage. Review pending medical claims and the refund schedule first.")) run(() => cancelPolicy(policy.policyId), "Policy cancelled; you may request its contractual refund.");
      }}>Cancel policy for refund</button>}
      {eligible && retryable && status === "CANCELLED" && <button type="button" disabled={acting} onClick={() => run(() => requestPolicyBenefit(policy.policyId, 1, ethers.ZeroHash), "Cancellation refund requested for insurer review.")}>Request cancellation refund</button>}
    </>}
    {requests.length > 0 && <ul>{requests.map((request) => <li key={request.requestId}>Refund #{request.requestId}: {request.status.label} · {request.amountEth} test ETH</li>)}</ul>}
    {data.withdrawalReceipt && <p role="status">Latest wallet refund withdrawal confirmed: {data.withdrawalReceipt.amountEth} test ETH · <TransactionLink txHash={data.withdrawalReceipt.transactionHash} />. A wallet withdrawal can combine allocated refunds from multiple policies; the request decision remains allocated.</p>}
    {BigInt(data.claimable?.wei || "0") > 0n && <button type="button" disabled={acting} onClick={() => run(withdrawPolicyBenefit, "Allocated refund withdrawn.")}>Withdraw cancellation refund</button>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
