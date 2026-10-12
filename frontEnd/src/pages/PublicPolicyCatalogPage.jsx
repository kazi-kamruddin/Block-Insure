import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import PaginationControls from "../components/PaginationControls";
import PolicyTermsPanel from "../components/PolicyTermsPanel";
import { getPolicyPackages } from "../services/api";
import "../styles/pages/PublicPolicyPages.css";

export default function PublicPolicyCatalogPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useQuery({
    queryKey: ["publicPolicyPackages", page],
    queryFn: () => getPolicyPackages({ page }),
  });
  const packages = data?.packages || [];

  return (
    <section className="page-container page-public-policies">
      <div className="public-policy-heading">
        <span className="dashboard-eyebrow">Available without an account</span>
        <h1>Policy Catalog</h1>
        <p>
          Compare coverage, waiting periods, exclusions, and the complete policy
          document before connecting a wallet or purchasing.
        </p>
      </div>

      {isLoading ? <p>Loading available policies...</p> : null}
      {error ? <p className="error-text">Could not load policy packages.</p> : null}
      {!isLoading && !error && packages.length === 0 ? (
        <p>No policy packages are currently available.</p>
      ) : null}

      <div className="public-policy-grid">
        {packages.map((policyPackage) => (
          <article className="card public-policy-card" key={policyPackage.packageId}>
            <span className="dashboard-eyebrow">{policyPackage.policyType}</span>
            <h2>{policyPackage.name}</h2>
            <div className="public-policy-metrics">
              <div><span>Premium</span><strong>{policyPackage.premiumAmountEth} ETH</strong></div>
              <div><span>Coverage</span><strong>{policyPackage.coverageAmountEth} ETH</strong></div>
              <div><span>Duration</span><strong>{policyPackage.durationDays} days</strong></div>
            </div>
            <PolicyTermsPanel terms={policyPackage.policyTerms} />
            <Link
              className="primary-link-button"
              to={`/policies/${policyPackage.packageId}`}
            >
              View Full Policy
            </Link>
          </article>
        ))}
      </div>
      <PaginationControls pagination={data?.pagination} onPageChange={setPage} />
    </section>
  );
}
