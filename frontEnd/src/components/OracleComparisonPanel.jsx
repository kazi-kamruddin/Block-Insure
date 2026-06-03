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

function extractRiskAssessment(log) {
  return (
    log?.responseData?.hospitalVerification?.riskAssessment ||
    log?.hospitalVerification?.riskAssessment ||
    log?.responseData?.riskAssessment ||
    log?.riskAssessment ||
    null
  );
}

export default function OracleComparisonPanel({ log }) {
  const comparison = extractComparison(log);
  const hospitalVerification = extractHospitalVerification(log);
  const riskAssessment = extractRiskAssessment(log);
  const checks = comparison?.fieldChecks
    ? Object.entries(comparison.fieldChecks)
    : [];
  const riskDrivers = riskAssessment?.riskDrivers || [];
  const anomalySignals = riskAssessment?.anomalySignals
    ? Object.entries(riskAssessment.anomalySignals)
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

      {riskAssessment ? (
        <div className="oracle-risk-model">
          <div className="oracle-risk-model-header">
            <div>
              <h4>Bayesian Risk Model</h4>
              <p>{formatValue(riskAssessment.modelVersion)}</p>
            </div>
            <span
              className={`oracle-risk-score is-${String(
                riskAssessment.riskLevel || "low"
              ).toLowerCase()}`}
            >
              {formatValue(riskAssessment.posteriorFraudPercent)}% fraud
            </span>
          </div>

          <div className="oracle-comparison-metrics">
            <span>Risk level: {formatValue(riskAssessment.riskLevel)}</span>
            <span>
              Prior fraud:{" "}
              {formatValue(riskAssessment.dataset?.priorFraudPercent)}%
            </span>
            <span>
              Active evidence: {formatValue(riskAssessment.activeEvidenceCount)}
            </span>
            <span>
              Recommendation: {formatValue(riskAssessment.recommendation)}
            </span>
          </div>

          {riskDrivers.length > 0 ? (
            <div className="oracle-risk-drivers">
              {riskDrivers.map((driver) => (
                <span key={driver.key}>
                  {driver.label} ({formatValue(driver.logLikelihoodRatio)})
                </span>
              ))}
            </div>
          ) : (
            <p className="oracle-comparison-source">
              No active high-risk evidence was detected by the Bayesian model.
            </p>
          )}

          {anomalySignals.length > 0 ? (
            <div className="oracle-anomaly-grid">
              {anomalySignals.map(([key, signal]) => (
                <article
                  className={`oracle-anomaly-signal ${
                    signal.isAnomaly ? "is-anomaly" : ""
                  }`}
                  key={key}
                >
                  <strong>{formatValue(signal.metric || key)}</strong>
                  <span>Z-score: {formatValue(signal.zScore)}</span>
                  <span>Mean: {formatValue(signal.mean)}</span>
                  <span>Value: {formatValue(signal.value)}</span>
                </article>
              ))}
            </div>
          ) : null}
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
