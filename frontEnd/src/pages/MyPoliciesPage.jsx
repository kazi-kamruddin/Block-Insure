import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { getMyPolicies } from "../services/api";
import { useWallet } from "../context/useWallet";
import { payPolicyPremium, reinstatePolicy } from "../services/contractService";
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
    setActingPolicyId(policy.policyId);

    try {
      const premiumWei = BigInt(policy.premiumAmountWei || policy.premiumPaidWei || 0);
      const tx =
        actionType === "reinstate"
          ? await reinstatePolicy(policy.policyId, premiumWei)
          : await payPolicyPremium(policy.policyId, premiumWei);

      await tx.wait();
      setActionMessage(
        actionType === "reinstate"
          ? `Policy #${policy.policyId} reinstated.`
          : `Premium paid for policy #${policy.policyId}.`
      );
      await refetch();
    } catch (error) {
      setActionError(
        error.reason ||
          error.shortMessage ||
          error.response?.data?.message ||
          error.message ||
          "Premium action failed"
      );
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

      {!isLoading && policies.length === 0 ? (
        <p>No purchased policies found for this wallet yet.</p>
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
