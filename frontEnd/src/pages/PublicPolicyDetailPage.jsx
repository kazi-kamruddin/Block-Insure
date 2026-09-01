import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import {
  getPublicPolicyDocumentUrl,
  getPublicPolicyPackage,
} from "../services/api";
import { useWallet } from "../context/useWallet";
import "../styles/pages/PublicPolicyPages.css";

function readableList(values = []) {
  return values.map((value) => value.replaceAll("_", " ")).join(", ");
}

export default function PublicPolicyDetailPage() {
  const { packageId } = useParams();
  const { isConnected, role, connectWallet, isConnecting } = useWallet();
  const { data, isLoading, error } = useQuery({
    queryKey: ["publicPolicyPackage", packageId],
    queryFn: () => getPublicPolicyPackage(packageId),
    enabled: Boolean(packageId),
  });
  const policyPackage = data?.policyPackage;
  const terms = policyPackage?.policyTerms;
  const benefits = policyPackage?.benefitTerms;
  const document = policyPackage?.policyDocument;

  if (isLoading) {
    return <section className="page-container"><p>Loading full policy...</p></section>;
  }

  if (error || !policyPackage) {
    return (
      <section className="page-container">
        <h1>Policy unavailable</h1>
        <p className="error-text">The selected policy document could not be loaded.</p>
        <Link to="/policies">Return to Policy Catalog</Link>
      </section>
    );
  }

  return (
    <article className="page-container page-policy-document">
      <Link to="/policies">← Policy Catalog</Link>
      <header className="policy-document-heading">
        <div>
          <span className="dashboard-eyebrow">Full digital policy document</span>
          <h1>{policyPackage.name}</h1>
          <p>{terms.summary}</p>
        </div>
        <div className="policy-document-commitment">
          <span>Document version</span>
          <strong>{document.documentVersion}</strong>
          <code>{document.documentHash}</code>
        </div>
      </header>

      <section className="policy-document-section">
        <h2>Policy Schedule</h2>
        <dl className="policy-document-grid">
          <div><dt>Premium</dt><dd>{policyPackage.premiumAmountEth} ETH</dd></div>
          <div><dt>Coverage limit</dt><dd>{policyPackage.coverageAmountEth} ETH</dd></div>
          <div><dt>Duration</dt><dd>{policyPackage.durationDays} days</dd></div>
          <div><dt>Required document</dt><dd>{policyPackage.requiredDocumentType}</dd></div>
        </dl>
      </section>

      <section className="policy-document-section">
        <h2>Coverage and Waiting Periods</h2>
        <p><strong>Covered:</strong> {readableList(terms.coveredClaimTypes)}</p>
        <p><strong>Excluded:</strong> {readableList(terms.excludedClaimTypes)}</p>
        <p>Initial waiting period: {terms.waitingPeriodDays} days.</p>
        <p>Pre-existing-condition waiting period: {terms.preExistingConditionWaitingDays} days.</p>
        <p>Insurer share after applicable limits: {terms.coinsuranceBps / 100}%.</p>
      </section>

      <section className="policy-document-section">
        <h2>Additional Benefits</h2>
        {benefits?.configured ? (
          <ul>
            <li>Death benefit: {benefits.deathBenefitEnabled ? `${benefits.deathBenefitPercent}% of coverage` : "Not included"}</li>
            <li>Surrender: {benefits.surrenderEnabled ? `${benefits.surrenderValuePercent}% after ${benefits.minimumSurrenderInstallments} installments` : "Not included"}</li>
            <li>Maturity bonus: {benefits.maturityEnabled ? `${benefits.maturityBonusPercent}%` : "Not included"}</li>
          </ul>
        ) : <p>No additional benefit schedule is currently published.</p>}
      </section>

      <details className="policy-document-source">
        <summary>Browse the complete policy text</summary>
        <pre>{document.content}</pre>
      </details>

      <div className="policy-document-actions">
        <a href={getPublicPolicyDocumentUrl(packageId, { download: true })}>
          Download Full Policy
        </a>
        {isConnected && role === "USER" ? (
          <Link className="primary-link-button" to="/user/policies/buy">
            Continue to Purchase
          </Link>
        ) : !isConnected ? (
          <button type="button" onClick={connectWallet} disabled={isConnecting}>
            {isConnecting ? "Connecting..." : "Connect Wallet to Purchase"}
          </button>
        ) : null}
      </div>
      <p className="muted-text">
        Purchase requires acceptance of this exact version and document commitment.
      </p>
    </article>
  );
}
