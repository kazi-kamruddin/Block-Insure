import "../styles/components/PolicyRules.css";

export default function PolicyTermsPanel({ terms }) {
  if (!terms) return null;

  return (
    <details className="policy-terms-panel">
      <summary>Policy terms — {terms.displayName} v{terms.version}</summary>
      <p>{terms.summary}</p>
      <dl className="policy-terms-grid">
        <div>
          <dt>Initial wait</dt>
          <dd>{terms.waitingPeriodDays} days</dd>
        </div>
        <div>
          <dt>Pre-existing wait</dt>
          <dd>{terms.preExistingConditionWaitingDays} days</dd>
        </div>
        <div>
          <dt>Policy share</dt>
          <dd>{terms.coinsuranceBps / 100}%</dd>
        </div>
      </dl>
      <p>
        <strong>Covered:</strong> {terms.coveredClaimTypes.join(", ").replaceAll("_", " ")}
      </p>
      <p>
        <strong>Excluded:</strong> {terms.excludedClaimTypes.join(", ").replaceAll("_", " ")}
      </p>
      <small>{terms.notice}</small>
    </details>
  );
}
