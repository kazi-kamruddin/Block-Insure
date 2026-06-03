function formatValue(value) {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function extractComparison(log) {
  return (
    log?.responseData?.hospitalVerification?.comparison ||
    log?.hospitalVerification?.comparison ||
    log?.responseData?.comparison ||
    log?.comparison ||
    null
  );
}

function extractHospitalVerification(log) {
  return (
    log?.responseData?.hospitalVerification ||
    log?.hospitalVerification ||
    null
  );
}

export default function OracleComparisonPanel({ log }) {
  const comparison = extractComparison(log);
  const hospitalVerification = extractHospitalVerification(log);
  const checks = comparison?.fieldChecks
    ? Object.entries(comparison.fieldChecks)
    : [];

  if (!comparison) {
    return null;
  }

  const verified =
    hospitalVerification?.verified ?? log?.verified ?? comparison.blockingFailureCount === 0;
  const blockingFailures = comparison.blockingFailures || [];
  const warningFailures = comparison.warningFailures || [];
  const record = hospitalVerification?.record;

  return (
    <div className="oracle-comparison">
      <div className="oracle-comparison-header">
        <div>
          <h4>Registry Comparison</h4>
          <p>
            {comparison.passedChecks} of {comparison.totalChecks} checks passed
          </p>
        </div>
        <span
          className={`oracle-comparison-score ${
            verified ? "is-verified" : "is-failed"
          }`}
        >
          {formatValue(comparison.matchScore)}% match
        </span>
      </div>

      <div className="oracle-comparison-metrics">
        <span>Blocking failures: {formatValue(comparison.blockingFailureCount)}</span>
        <span>Warnings: {formatValue(comparison.warningFailureCount)}</span>
        <span>Decision: {verified ? "Verified" : "Rejected"}</span>
      </div>

      {blockingFailures.length > 0 ? (
        <div className="oracle-comparison-alert is-blocking">
          <strong>Blocking mismatch:</strong>{" "}
          {blockingFailures.map((failure) => failure.label).join(", ")}
        </div>
      ) : null}

      {warningFailures.length > 0 ? (
        <div className="oracle-comparison-alert is-warning">
          <strong>Non-blocking warning:</strong>{" "}
          {warningFailures.map((failure) => failure.label).join(", ")}
        </div>
      ) : null}

      <div className="oracle-comparison-grid">
        {checks.map(([field, check]) => (
          <article
            className={`oracle-comparison-check ${
              check.matched ? "is-pass" : "is-fail"
            } ${check.blocking === false ? "is-soft" : ""}`}
            key={field}
          >
            <div className="oracle-comparison-check-head">
              <strong>{check.label || field}</strong>
              <span>{check.matched ? "MATCH" : "MISMATCH"}</span>
            </div>

            <dl>
              <div>
                <dt>Expected</dt>
                <dd>{formatValue(check.expected)}</dd>
              </div>
              <div>
                <dt>Actual</dt>
                <dd>{formatValue(check.actual)}</dd>
              </div>
            </dl>

            {check.note ? <p>{check.note}</p> : null}
          </article>
        ))}
      </div>

      {record ? (
        <p className="oracle-comparison-source">
          Registry source: {formatValue(record.hospitalId)} /{" "}
          {formatValue(record.invoiceNumber)} / {formatValue(record.treatmentType)}
        </p>
      ) : null}
    </div>
  );
}
