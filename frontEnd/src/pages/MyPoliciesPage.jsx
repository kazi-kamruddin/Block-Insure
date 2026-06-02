import { useQuery } from "@tanstack/react-query";

import { getMyPolicies } from "../services/api";
import { useWallet } from "../context/useWallet";
import "../styles/pages/MyPoliciesPage.css";

function extractPolicies(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.policies)) return data.policies;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function formatUnixDate(unixSeconds) {
  if (!unixSeconds) return "-";
  return new Date(Number(unixSeconds) * 1000).toLocaleString();
}

export default function MyPoliciesPage() {
  const { isConnected, walletAddress } = useWallet();

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
            <p>Active: {String(policy.isActive)}</p>
            <p>Start: {formatUnixDate(policy.startDate)}</p>
            <p>End: {formatUnixDate(policy.endDate)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
