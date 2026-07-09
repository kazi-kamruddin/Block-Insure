import TransactionLink from "./TransactionLink";

function formatValue(value) {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatTimestamp(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? formatValue(value) : date.toLocaleString();
}

function formatDuration(ms) {
  if (ms === undefined || ms === null || ms === "") return "-";
  const value = Number(ms);
  if (!Number.isFinite(value)) return "-";
  return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${value}ms`;
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
  return log?.responseData?.hospitalVerification || log?.hospitalVerification || null;
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

function extractMerkleProof(log) {
  return (
    log?.responseData?.hospitalVerification?.merkleProof ||
    log?.hospitalVerification?.merkleProof ||
    log?.responseData?.merkleProof ||
    log?.merkleProof ||
    null
  );
}

function getOracleWallet(log) {
  return (
    log?.oracleWallet ||
    log?.responseData?.oracleWallet ||
    log?.hospitalVerification?.oracleWallet ||
    "-"
  );
}

function getOracleLabel(log) {
  return (
    log?.oracleLabel ||
    log?.responseData?.oracleLabel ||
    log?.responseData?.label ||
    log?.oracleInstanceId ||
    log?.oracleType ||
    "Oracle"
  );
}

function getRegistrySnapshot(log, merkleProof) {
  return (
    log?.responseData?.registrySnapshot ||
    log?.responseData?.registryCommitment?.snapshotId ||
    log?.responseData?.registryRoot ||
    merkleProof?.rootHash ||
    "-"
  );
}

function getRegistryRootMatched(log, merkleProof) {
  if (log?.registryRootMatched !== undefined) return log.registryRootMatched;
  if (log?.responseData?.merkleRootMatchesChain !== undefined) {
    return log.responseData.merkleRootMatchesChain;
  }

  const onChainRoot = log?.responseData?.registryCommitment?.onChainRoot;
  if (onChainRoot && merkleProof?.rootHash) {
    return String(onChainRoot).toLowerCase() === String(merkleProof.rootHash).toLowerCase();
  }

  return null;
}

function QuorumSummary({ summary, logs }) {
  if (!summary && !logs.length) return null;

  const verifiedCount =
    summary?.verifiedCount ?? logs.filter((item) => item.verified === true).length;
  const failedCount =
    summary?.failedCount ?? logs.filter((item) => item.verified === false).length;

  return (
    <div className="oracle-merkle-proof">
      <div className="oracle-merkle-proof-header">
        <div>
          <h4>Oracle Quorum</h4>
          <p>{summary?.claimStatus || "Awaiting oracle state"}</p>
        </div>
        <span
          className={`oracle-merkle-status ${
            summary?.finalOutcome === "VERIFIED" ? "is-verified" : ""
          } ${summary?.finalOutcome === "FAILED" || summary?.timedOut ? "is-failed" : ""}`}
        >
          {summary?.finalOutcome || "PENDING"}
        </span>
      </div>

      <div className="oracle-comparison-metrics">
        <span>Confirmations: {summary?.confirmationsReceived ?? logs.length}</span>
        <span>Required: {summary?.requiredQuorum ?? "-"}</span>
        <span>Verified: {verifiedCount}</span>
        <span>Failed: {failedCount}</span>
        <span>Pending: {summary?.pendingCount ?? "-"}</span>
        <span>{summary?.timedOut ? "Timed out" : summary?.isFulfilled ? "Finalized" : "Pending"}</span>
      </div>
    </div>
  );
}

function OracleLogCard({ log }) {
  const comparison = extractComparison(log);
  const hospitalVerification = extractHospitalVerification(log);
  const riskAssessment = extractRiskAssessment(log);
  const merkleProof = extractMerkleProof(log);
  const rootMatched = getRegistryRootMatched(log, merkleProof);
  const checks = comparison?.fieldChecks ? Object.entries(comparison.fieldChecks) : [];
  const riskDrivers = riskAssessment?.riskDrivers || [];
  const verified =
    hospitalVerification?.verified ?? log?.verified ?? comparison?.blockingFailureCount === 0;

  return (
    <div className="oracle-comparison">
      <div className="oracle-comparison-header">
        <div>
          <h4>{formatValue(getOracleLabel(log))}</h4>
          <p>{formatValue(getOracleWallet(log))}</p>
        </div>
        <span className={`oracle-comparison-score ${verified ? "is-verified" : "is-failed"}`}>
          {verified ? "Verified" : "Failed"}
        </span>
      </div>

      <div className="oracle-comparison-metrics">
        <span>Identity: {formatValue(log.responseData?.configIdentity || log.oracleInstanceId)}</span>
        <span>Registry snapshot: {formatValue(getRegistrySnapshot(log, merkleProof))}</span>
        <span>Registry root: {rootMatched === null ? "N/A" : rootMatched ? "Match" : "Mismatch"}</span>
        <span>Risk: {formatValue(log.riskLevel || riskAssessment?.riskLevel)}</span>
        <span>Response: {formatDuration(log.responseTimeMs)}</span>
        <span>Timestamp: {formatTimestamp(log.timestamp || log.createdAt)}</span>
      </div>

      <p className="oracle-comparison-source">
        Remarks: {formatValue(log.remarks || log.responseData?.remarks || hospitalVerification?.message)}
      </p>

      <p>
        Tx: <TransactionLink txHash={log.submittedTxHash || log.txHash} />
      </p>

      {comparison ? (
        <>
          <div className="oracle-comparison-metrics">
            <span>{comparison.passedChecks} / {comparison.totalChecks} checks passed</span>
            <span>Blocking failures: {formatValue(comparison.blockingFailureCount)}</span>
            <span>Warnings: {formatValue(comparison.warningFailureCount)}</span>
            <span>Match score: {formatValue(comparison.matchScore)}%</span>
          </div>

          <div className="oracle-comparison-grid">
            {checks.map(([field, check]) => (
              <article
                className={`oracle-comparison-check ${check.matched ? "is-pass" : "is-fail"} ${
                  check.blocking === false ? "is-soft" : ""
                }`}
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
              </article>
            ))}
          </div>
        </>
      ) : null}

      {riskAssessment ? (
        <div className="oracle-risk-model">
          <div className="oracle-risk-model-header">
            <div>
              <h4>Bayesian Risk Model</h4>
              <p>{formatValue(riskAssessment.modelVersion)}</p>
            </div>
            <span className={`oracle-risk-score is-${String(riskAssessment.riskLevel || "low").toLowerCase()}`}>
              {formatValue(riskAssessment.posteriorFraudPercent)}% fraud
            </span>
          </div>
          {riskDrivers.length ? (
            <div className="oracle-risk-drivers">
              {riskDrivers.map((driver) => (
                <span key={driver.key}>{driver.label} ({formatValue(driver.logLikelihoodRatio)})</span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {merkleProof ? (
        <div className="oracle-merkle-proof">
          <div className="oracle-merkle-proof-header">
            <div>
              <h4>Merkle Registry Proof</h4>
              <p>{formatValue(merkleProof.treeVersion)}</p>
            </div>
            <span className={`oracle-merkle-status ${merkleProof.verified ? "is-verified" : "is-failed"}`}>
              {merkleProof.verified ? "Proof valid" : "Not proven"}
            </span>
          </div>
          <div className="oracle-comparison-metrics">
            <span>Leaves: {formatValue(merkleProof.leafCount)}</span>
            <span>Depth: {formatValue(merkleProof.treeDepth)}</span>
            <span>Proof path: {formatValue(merkleProof.proofLength ?? merkleProof.proof?.length)}</span>
          </div>
          <dl className="oracle-merkle-hashes">
            <div>
              <dt>Root hash</dt>
              <dd>{formatValue(merkleProof.rootHash)}</dd>
            </div>
            <div>
              <dt>Leaf hash</dt>
              <dd>{formatValue(merkleProof.leafHash)}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  );
}

export default function OracleComparisonPanel({ log, logs, quorumSummary }) {
  const oracleLogs = logs || (log ? [log] : []);

  if (!oracleLogs.length) {
    return <p>No oracle result found yet.</p>;
  }

  return (
    <div className="oracle-comparison-panel">
      <QuorumSummary summary={quorumSummary} logs={oracleLogs} />
      {oracleLogs.map((oracleLog) => (
        <OracleLogCard
          key={oracleLog._id || `${oracleLog.requestId}-${oracleLog.oracleWallet || oracleLog.resultHash}`}
          log={oracleLog}
        />
      ))}
    </div>
  );
}
