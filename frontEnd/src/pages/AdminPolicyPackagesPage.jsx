import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { getPolicyPackages } from "../services/api";

function extractPackages(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.packages)) return data.packages;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

export default function AdminPolicyPackagesPage() {
  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["adminPolicyPackages"],
    queryFn: getPolicyPackages,
  });

  const packages = extractPackages(data);

  return (
    <section className="page-container">
      <h2>Admin Policy Packages</h2>

      <div className="action-row">
        <Link to="/admin/policy-packages/new">Create New Package</Link>

        <button type="button" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Refreshing..." : "Refresh Packages"}
        </button>
      </div>

      {error ? (
        <p className="error-text">
          {error.message || "Could not load policy packages"}
        </p>
      ) : null}

      {isLoading ? <p>Loading policy packages...</p> : null}

      {!isLoading && packages.length === 0 ? (
        <p>No policy packages found.</p>
      ) : null}

      <div className="card-row">
        {packages.map((policyPackage) => (
          <div className="card" key={policyPackage.packageId}>
            <h3>{policyPackage.name}</h3>

            <p>Package ID: {policyPackage.packageId}</p>
            <p>Type: {policyPackage.policyType}</p>
            <p>Premium: {policyPackage.premiumAmountEth} ETH</p>
            <p>Coverage: {policyPackage.coverageAmountEth} ETH</p>
            <p>Duration: {policyPackage.durationDays} days</p>
            <p>Required document: {policyPackage.requiredDocumentType}</p>
            <p>Active: {String(policyPackage.isActive ?? true)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}