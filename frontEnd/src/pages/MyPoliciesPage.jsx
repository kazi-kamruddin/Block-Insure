import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { getMyPolicies } from "../services/api";
import PaginationControls from "../components/PaginationControls";
import TransactionLink from "../components/TransactionLink";
import PolicyBenefitsPanel from "../components/PolicyBenefitsPanel";
import { useWallet } from "../context/useWallet";
import { showToast } from "../services/toast";
import {
  parseTransactionError,
  payPolicyPremium,
  reinstatePolicy,
} from "../services/contractService";
import "../styles/pages/MyPoliciesPage.css";

function extractPolicies(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.policies)) return data.policies;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function formatUnixDate(unixSeconds) {
  const value = Number(unixSeconds || 0);
  if (!value) return "-";
  return new Date(value * 1000).toLocaleString();
}

function getInstallmentProgress(policy) {
  const start = Number(policy.startDate || 0);
  const end = Number(policy.endDate || 0);
  const interval = Number(policy.premiumInterval || 0);
  const paid = Number(policy.installmentsPaid || 0);
  const expected =
    interval > 0 && end > start
      ? Math.max(1, Math.ceil((end - start) / interval))
      : Math.max(1, paid);

  return {
    paid,
    expected,
    percentage: Math.min(100, Math.round((paid / expected) * 100)),
  };
}

export default function MyPoliciesPage() {
  const { isConnected, walletAddress } = useWallet();
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [actingPolicyId, setActingPolicyId] = useState("");
  const [page, setPage] = useState(1);

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["myPolicies", walletAddress, page],
    queryFn: () => getMyPolicies({ page }),
    enabled: isConnected,
  });

  const policies = extractPolicies(data);

  async function runPremiumAction(policy, actionType) {
    setActionMessage("");
    setActionError("");
    setTransactionHash("");
    setActingPolicyId(policy.policyId);

    try {
      const premiumWei = BigInt(policy.premiumAmountWei || policy.premiumPaidWei || 0);
      const tx =
        actionType === "reinstate"
          ? await reinstatePolicy(policy.policyId, premiumWei)
          : await payPolicyPremium(policy.policyId, premiumWei);

      await tx.wait();
      setTransactionHash(tx.hash);
      const message =
        actionType === "reinstate"
          ? `${policy.packageName || `Policy #${policy.policyId}`} reinstated successfully.`
          : `Premium paid for ${policy.packageName || `policy #${policy.policyId}`}.`;
      setActionMessage(message);
      showToast(message);
      await refetch();
    } catch (error) {
      const message = parseTransactionError(error);
      setActionError(message);
      showToast(message, { tone: "error", title: "Policy action failed" });
    } finally {
      setActingPolicyId("");
    }
  }

  return (
    <section className="page-container page-my-policies">
      <h2>My Policies</h2>

      <button
        type="button"
        onClick={() => refetch()}
        disabled={!isConnected || isFetching}
      >
        {isFetching ? "Refreshing..." : "Refresh My Policies"}
      </button>

      {error ? (
        <p className="error-text">
          {error.message || "Could not load your policies"}
        </p>
      ) : null}

      {isLoading ? <p>Loading policies...</p> : null}
      {actionMessage ? <p className="success-text">{actionMessage}</p> : null}
      {actionError ? <p className="error-text">{actionError}</p> : null}
      {transactionHash ? (
        <p>
          Transaction: <TransactionLink txHash={transactionHash} />
        </p>
      ) : null}

      {!isLoading && !error && policies.length === 0 ? (
        <div className="card empty-state">
          <span className="dashboard-eyebrow">No active coverage</span>
          <h3>Purchase your first policy</h3>
          <p>
            A purchased and active policy is required before you can submit a
            claim.
          </p>
          <Link to="/user/policies/buy">Browse Policy Packages</Link>
        </div>
      ) : null}

      <div className="card-row">
        {policies.map((policy) => (
          <article className="card policy-lifecycle-card" key={policy.policyId}>
            <div className="policy-card-heading">
              <div>
                <span className="dashboard-eyebrow">Policy #{policy.policyId}</span>
                <h3>{policy.packageName || `Package #${policy.packageId}`}</h3>
                <p>{policy.policyType || "Insurance coverage"}</p>
              </div>
              <strong className="policy-state">
                {policy.status?.label || (policy.isActive ? "ACTIVE" : "INACTIVE")}
              </strong>
            </div>
            <div className="policy-metric-grid">
              <div><span>Coverage</span><strong>{policy.coverageAmountEth || policy.coverageAmount} ETH</strong></div>
              <div><span>Recurring premium</span><strong>{policy.premiumAmountEth || policy.premiumPaidEth} ETH</strong></div>
              <div><span>Total paid</span><strong>{policy.totalPremiumPaidEth || policy.premiumPaidEth} ETH</strong></div>
            </div>
            {(() => {
              const progress = getInstallmentProgress(policy);
              return (
                <div className="premium-progress">
                  <div>
                    <strong>Premium progress</strong>
                    <span>{progress.paid} of {progress.expected} scheduled installments</span>
                  </div>
                  <progress value={progress.percentage} max="100" />
                </div>
              );
            })()}
            <div className="policy-timeline">
              <div><span>Coverage began</span><strong>{formatUnixDate(policy.startDate)}</strong></div>
              <div><span>Next premium due</span><strong>{formatUnixDate(policy.nextPremiumDueDate)}</strong></div>
              <div><span>Grace deadline</span><strong>{formatUnixDate(policy.gracePeriodEnd)}</strong></div>
              <div><span>Coverage ends</span><strong>{formatUnixDate(policy.endDate)}</strong></div>
            </div>
            <div className="action-row">
              {["ACTIVE", "GRACE_PERIOD"].includes(policy.status?.label) ? <button
                type="button"
                onClick={() => runPremiumAction(policy, "pay")}
                disabled={actingPolicyId === policy.policyId}
              >
                {actingPolicyId === policy.policyId ? "Confirming..." : "Pay Premium"}
              </button> : null}
              {policy.status?.label === "LAPSED" ? <button
                type="button"
                onClick={() => runPremiumAction(policy, "reinstate")}
                disabled={actingPolicyId === policy.policyId}
              >
                Reinstate
              </button> : null}
            </div>
            <PolicyBenefitsPanel policy={policy} onPolicyChanged={refetch} />
            <details className="technical-details">
              <summary>Technical policy details</summary>
              <p>Package ID: {policy.packageId}</p>
              <p>Holder wallet: {policy.holderWallet}</p>
            </details>
          </article>
        ))}
      </div>
      <PaginationControls
        pagination={data?.pagination}
        onPageChange={setPage}
      />
    </section>
  );
}
