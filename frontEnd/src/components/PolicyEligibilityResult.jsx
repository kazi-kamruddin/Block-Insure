import "../styles/components/PolicyRules.css";

const OUTCOME_LABELS = {
  COVERED: "Covered",
  PARTIAL_BENEFIT: "Partial benefit",
  MANUAL_REVIEW: "Manual review",
  WAITING_PERIOD: "Waiting period",
  EXCLUDED: "Excluded",
  OUTSIDE_COVERAGE: "Outside coverage",
};

export default function PolicyEligibilityResult({ evaluation, title = "Eligibility preview" }) {
  if (!evaluation) return null;

  return (
    <section className={`eligibility-result outcome-${evaluation.outcome.toLowerCase()}`}>
      <div className="eligibility-result-heading">
        <h3>{title}</h3>
        <strong>{OUTCOME_LABELS[evaluation.outcome] || evaluation.outcome}</strong>
      </div>
      <p>
        Estimated benefit: <strong>{evaluation.amounts.estimatedBenefitEth} ETH</strong>
        {" "}from {evaluation.amounts.requestedEth} ETH requested.
      </p>
      <ul>
        {evaluation.reasons.map((reason) => (
          <li key={reason.code}>{reason.message}</li>
        ))}
      </ul>
      <small>
        {evaluation.ruleSet.displayName} v{evaluation.ruleSet.version}. {evaluation.notice}
      </small>
    </section>
  );
}
