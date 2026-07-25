import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { getMyPolicies } from "../services/api";
import TransactionLink from "../components/TransactionLink";
import { useWallet } from "../context/useWallet";
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

export default function MyPoliciesPage() {
  const { isConnected, walletAddress } = useWallet();
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [actingPolicyId, setActingPolicyId] = useState("");

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["myPolicies", walletAddress],
    queryFn: getMyPolicies,
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
      setActionMessage(
        actionType === "reinstate"
          ? `Policy #${policy.policyId} reinstated.`
          : `Premium paid for policy #${policy.policyId}.`
      );
      await refetch();
    } catch (error) {
      setActionError(parseTransactionError(error));
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
          <div className="card" key={policy.policyId}>
            <h3>Policy #{policy.policyId}</h3>

            <p>Package ID: {policy.packageId}</p>
            <p>Holder: {policy.holderWallet}</p>
            <p>
              Coverage: {policy.coverageAmountEth || policy.coverageAmount} ETH
            </p>
            <p>Premium paid: {policy.premiumPaidEth || policy.premiumPaid} ETH</p>
            <p>Total premium paid: {policy.totalPremiumPaidEth || policy.premiumPaidEth} ETH</p>
            <p>Installments paid: {policy.installmentsPaid || "1"}</p>
            <p>Status: {policy.status?.label || (policy.isActive ? "ACTIVE" : "INACTIVE")}</p>
            <p>Next premium due: {formatUnixDate(policy.nextPremiumDueDate)}</p>
            <p>Grace period end: {formatUnixDate(policy.gracePeriodEnd)}</p>
            <p>Start: {formatUnixDate(policy.startDate)}</p>
            <p>End: {formatUnixDate(policy.endDate)}</p>
            <div className="action-row">
              <button
                type="button"
                onClick={() => runPremiumAction(policy, "pay")}
                disabled={
                  actingPolicyId === policy.policyId ||
                  !["ACTIVE", "GRACE_PERIOD"].includes(policy.status?.label)
                }
                title={
                  ["ACTIVE", "GRACE_PERIOD"].includes(policy.status?.label)
                    ? ""
                    : "Premium payment is only available for active or grace-period policies"
                }
              >
                Pay Premium
              </button>
              <button
                type="button"
                onClick={() => runPremiumAction(policy, "reinstate")}
                disabled={
                  actingPolicyId === policy.policyId ||
                  policy.status?.label !== "LAPSED"
                }
                title={
                  policy.status?.label === "LAPSED"
                    ? ""
                    : "Only lapsed policies can be reinstated"
                }
              >
                Reinstate
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
