import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  getAuditorReputationAnalysis,
  getEvaluationSummary,
  getGasComparison,
  getOnChainRegistryMerkleRoot,
  getOracleStats,
  getReserveIntelligence,
  getRiskDistribution,
  getThroughputResults,
} from "../services/api";
import "../styles/pages/ThesisResultsDashboardPage.css";

function extractSummary(data) {
  return data?.summary || data?.data?.summary || null;
}

function extractRows(data) {
  return data?.rows || data?.data?.rows || [];
}

function extractRiskBuckets(data) {
  return data?.buckets || data?.data?.buckets || [];
}

function extractOracleStats(data) {
  return data?.oracleStats || data?.data?.oracleStats || null;
}

function extractReserveIntelligence(data) {
  return data?.reserveIntelligence || data?.data?.reserveIntelligence || null;
}

function extractRegistrySnapshot(data) {
  return data?.registrySnapshot || data?.data?.registrySnapshot || null;
}

function extractThroughputResults(data) {
  return data?.throughputResults || data?.data?.throughputResults || null;
}

function extractAuditorAnalysis(data) {
  return data?.auditorAnalysis || data?.data?.auditorAnalysis || null;
}

function formatPercent(value, digits = 1) {
  const numericValue = Number(value || 0);
  return `${(numericValue * 100).toFixed(digits).replace(/\.0$/, "")}%`;
}

function formatGasPercent(value) {
  return `${Number(value || 0).toFixed(2).replace(/\.00$/, "")}%`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatEthValue(value) {
  if (value === undefined || value === null || value === "") return "0";
  return Number(value).toFixed(4).replace(/\.?0+$/, "");
}

function formatRatio(value) {
  if (value === null || value === undefined) return "-";
  return formatPercent(value, 0);
}

function formatTimestamp(timestamp) {
  const isoValue = timestamp?.iso;

  if (!isoValue) {
    return "-";
  }

  return new Date(isoValue).toLocaleString();
}

function getApiError(data, fallback) {
  return data?.error || data?.message || fallback;
}

function getGasRowForChart(rows) {
  return (
    rows.find((row) => Number(row.records) === 100) ||
    rows[Math.floor(rows.length / 2)] ||
    null
  );
}

function GasComparisonChart({ row }) {
  if (!row) return <p>No gas comparison data available.</p>;

  const maxGas = Math.max(row.individual_gas || 0, row.merkle_gas || 0, 1);
  const individualHeight = Math.max(8, (row.individual_gas / maxGas) * 130);
  const merkleHeight = Math.max(8, (row.merkle_gas / maxGas) * 130);

  return (
    <svg className="gas-chart" viewBox="0 0 320 180" role="img">
      <line x1="40" y1="150" x2="290" y2="150" />
      <rect
        className="gas-chart-individual"
        x="82"
        y={150 - individualHeight}
        width="58"
        height={individualHeight}
      />
      <rect
        className="gas-chart-merkle"
        x="182"
        y={150 - merkleHeight}
        width="58"
        height={merkleHeight}
      />
      <text x="111" y="170" textAnchor="middle">
        Individual
      </text>
      <text x="211" y="170" textAnchor="middle">
        Merkle
      </text>
      <text x="111" y={140 - individualHeight} textAnchor="middle">
        {formatNumber(row.individual_gas)}
      </text>
      <text x="211" y={140 - merkleHeight} textAnchor="middle">
        {formatNumber(row.merkle_gas)}
      </text>
    </svg>
  );
}

function ThroughputLatencyChart({ rows = [] }) {
  if (!rows.length) return <p>No throughput chart data available.</p>;

  const chartRows = rows.map((row) => ({
    concurrency: Number(row.concurrency || 0),
    throughput: Number(row.throughputClaimsPerSecond || 0),
    latency: Number(row.endToEnd?.averageMs || 0),
  }));
  const maxThroughput = Math.max(...chartRows.map((row) => row.throughput), 1);
  const maxLatency = Math.max(...chartRows.map((row) => row.latency), 1);
  const step = chartRows.length > 1 ? 240 / (chartRows.length - 1) : 240;
  const points = chartRows
    .map((row, index) => {
      const x = 40 + index * step;
      const y = 150 - (row.throughput / maxThroughput) * 110;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg className="throughput-chart" viewBox="0 0 330 190" role="img">
      <line x1="36" y1="150" x2="300" y2="150" />
      <polyline points={points} />
      {chartRows.map((row, index) => {
        const x = 40 + index * step;
        const barHeight = Math.max(6, (row.latency / maxLatency) * 92);
        const pointY = 150 - (row.throughput / maxThroughput) * 110;

        return (
          <g key={row.concurrency}>
            <rect
              className="throughput-latency-bar"
              x={x - 10}
              y={150 - barHeight}
              width="20"
              height={barHeight}
            />
            <circle cx={x} cy={pointY} r="4" />
            <text x={x} y="172" textAnchor="middle">
              {row.concurrency}
            </text>
          </g>
        );
      })}
      <text x="44" y="22">Claims/s line</text>
      <text x="205" y="22">E2E latency bars</text>
    </svg>
  );
}

function DataNotice({ data, fallback }) {
  if (!data || data.success !== false) return null;

  return <p className="error-text">{getApiError(data, fallback)}</p>;
}

export default function ThesisResultsDashboardPage() {
  const summaryQuery = useQuery({
    queryKey: ["evaluationSummary"],
    queryFn: getEvaluationSummary,
  });
  const gasQuery = useQuery({
    queryKey: ["gasComparison"],
    queryFn: getGasComparison,
  });
  const riskQuery = useQuery({
    queryKey: ["riskDistribution"],
    queryFn: getRiskDistribution,
  });
  const oracleQuery = useQuery({
    queryKey: ["oracleStats"],
    queryFn: getOracleStats,
  });
  const reserveQuery = useQuery({
    queryKey: ["thesisReserveIntelligence"],
    queryFn: getReserveIntelligence,
  });
  const registryQuery = useQuery({
    queryKey: ["thesisRegistrySnapshot"],
    queryFn: getOnChainRegistryMerkleRoot,
  });
  const throughputQuery = useQuery({
    queryKey: ["claimThroughputResults"],
    queryFn: getThroughputResults,
  });
  const auditorAnalysisQuery = useQuery({
    queryKey: ["auditorReputationAnalysis"],
    queryFn: getAuditorReputationAnalysis,
  });

  const summary = extractSummary(summaryQuery.data);
  const gasRows = extractRows(gasQuery.data);
  const riskBuckets = extractRiskBuckets(riskQuery.data);
  const oracleStats = extractOracleStats(oracleQuery.data);
  const reserve = extractReserveIntelligence(reserveQuery.data);
  const registrySnapshot = extractRegistrySnapshot(registryQuery.data);
  const throughputResults = extractThroughputResults(throughputQuery.data);
  const auditorAnalysis = extractAuditorAnalysis(auditorAnalysisQuery.data);
  const chartGasRow = getGasRowForChart(gasRows);
  const maxRiskBucketCount = Math.max(
    ...riskBuckets.map((bucket) => bucket.count),
    1
  );
  const riskLevelRows = useMemo(
    () =>
      ["LOW", "MEDIUM", "HIGH"].map((level) => [
        level,
        summary?.riskBuckets?.[level] || 0,
      ]),
    [summary]
  );
  const matrix = summary?.confusionMatrix || {};
  const metrics = summary?.metrics || {};
  const mostCommonRiskLevel = oracleStats?.mostCommonRiskLevels?.[0];
  const anyLoading =
    summaryQuery.isLoading ||
    gasQuery.isLoading ||
    riskQuery.isLoading ||
    oracleQuery.isLoading ||
    reserveQuery.isLoading ||
    registryQuery.isLoading ||
    throughputQuery.isLoading ||
    auditorAnalysisQuery.isLoading;

  function refreshAll() {
    summaryQuery.refetch();
    gasQuery.refetch();
    riskQuery.refetch();
    oracleQuery.refetch();
    reserveQuery.refetch();
    registryQuery.refetch();
    throughputQuery.refetch();
    auditorAnalysisQuery.refetch();
  }

  return (
    <section className="page-container page-thesis-results">
      <h2>Thesis Results Dashboard</h2>

      <button type="button" onClick={refreshAll} disabled={anyLoading}>
        {anyLoading ? "Refreshing..." : "Refresh Results"}
      </button>

      <div className="thesis-section card">
        <div className="thesis-section-head">
          <h3>Fraud Detection Performance</h3>
          <span>{summary?.dataset?.totalRecords || 0} held-out records</span>
        </div>
        <DataNotice data={summaryQuery.data} fallback="Run npm run evaluate:risk first" />
        {summaryQuery.error ? (
          <p className="error-text">{summaryQuery.error.message}</p>
        ) : null}

        <div className="thesis-metric-grid">
          <div>
            <span>Accuracy</span>
            <strong>{formatPercent(metrics.accuracy)}</strong>
          </div>
          <div>
            <span>Precision</span>
            <strong>{formatPercent(metrics.precision)}</strong>
          </div>
          <div>
            <span>Recall</span>
            <strong>{formatPercent(metrics.recall)}</strong>
          </div>
          <div>
            <span>F1 Score</span>
            <strong>{formatPercent(metrics.f1Score)}</strong>
          </div>
          <div>
            <span>ROC AUC</span>
            <strong>{Number(metrics.auc || 0).toFixed(4)}</strong>
          </div>
          <div>
            <span>Average Precision</span>
            <strong>{Number(metrics.averagePrecision || 0).toFixed(4)}</strong>
          </div>
          <div>
            <span>Selected Threshold</span>
            <strong>{summary?.decisionRule?.selectedThreshold ?? "-"}</strong>
          </div>
        </div>

        <div className="thesis-two-column">
          <table className="confusion-matrix">
            <thead>
              <tr>
                <th />
                <th>Predicted Fraud</th>
                <th>Predicted Legit</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>Actual Fraud</th>
                <td className="matrix-good">
                  TP <strong>{matrix.truePositive || 0}</strong>
                </td>
                <td className="matrix-warn">
                  FN <strong>{matrix.falseNegative || 0}</strong>
                </td>
              </tr>
              <tr>
                <th>Actual Legit</th>
                <td className="matrix-bad">
                  FP <strong>{matrix.falsePositive || 0}</strong>
                </td>
                <td className="matrix-good">
                  TN <strong>{matrix.trueNegative || 0}</strong>
                </td>
              </tr>
            </tbody>
          </table>

          <div className="risk-level-list">
            {riskLevelRows.map(([level, count]) => (
              <div key={level}>
                <span>{level}</span>
                <strong>{count}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="throughput-layout">
          <ThroughputLatencyChart rows={throughputResults?.rows || []} />
          <div className="thesis-chart-note">
            <strong>Reading this chart</strong>
            <p>
              The line tracks successful claims per second. The bars track
              average end-to-end latency, so rising bars with a flattening line
              indicate local transaction saturation.
            </p>
          </div>
        </div>

        <div className="thesis-table-wrap">
          <table className="thesis-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Accuracy</th>
                <th>Precision</th>
                <th>Recall</th>
                <th>F1</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Bayesian Model</td>
                <td>{formatPercent(metrics.accuracy)}</td>
                <td>{formatPercent(metrics.precision)}</td>
                <td>{formatPercent(metrics.recall)}</td>
                <td>{formatPercent(metrics.f1Score)}</td>
              </tr>
              {(summary?.baselines || []).map((baseline) => (
                <tr key={baseline.key}>
                  <td>{baseline.label}</td>
                  <td>{formatPercent(baseline.metrics.accuracy)}</td>
                  <td>{formatPercent(baseline.metrics.precision)}</td>
                  <td>{formatPercent(baseline.metrics.recall)}</td>
                  <td>{formatPercent(baseline.metrics.f1Score)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="thesis-section card">
        <div className="thesis-section-head">
          <h3>Claim Throughput and Latency</h3>
          <span>{throughputResults?.rows?.length || 0} concurrency levels</span>
        </div>
        <DataNotice
          data={throughputQuery.data}
          fallback="Run npm run loadtest:claims first"
        />

        <div className="thesis-table-wrap">
          <table className="thesis-table">
            <thead>
              <tr>
                <th>Parallel Claims</th>
                <th>Claims/s</th>
                <th>Backend Avg</th>
                <th>Blockchain Avg</th>
                <th>End-to-End Avg</th>
              </tr>
            </thead>
            <tbody>
              {(throughputResults?.rows || []).map((row) => (
                <tr key={row.concurrency}>
                  <td>{row.concurrency}</td>
                  <td>{row.throughputClaimsPerSecond}</td>
                  <td>{row.backend.averageMs} ms</td>
                  <td>{row.blockchain.averageMs} ms</td>
                  <td>{row.endToEnd.averageMs} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="thesis-section card">
        <div className="thesis-section-head">
          <h3>Auditor Reputation Validation</h3>
          <span>{auditorAnalysis?.auditorsAnalyzed || 0} auditors</span>
        </div>
        <DataNotice
          data={auditorAnalysisQuery.data}
          fallback="Run npm run analyze:auditors after finalizing demo votes"
        />

        <div className="thesis-metric-grid compact">
          <div>
            <span>Finalized Claims</span>
            <strong>{auditorAnalysis?.finalizedClaimsAnalyzed || 0}</strong>
          </div>
          <div>
            <span>Pearson Correlation</span>
            <strong>{auditorAnalysis?.pearsonCorrelation ?? "-"}</strong>
          </div>
          <div>
            <span>Interpretation</span>
            <strong className="metric-text">
              {auditorAnalysis?.interpretation || "No analysis available"}
            </strong>
          </div>
        </div>
      </div>

      <div className="thesis-section card">
        <div className="thesis-section-head">
          <h3>Gas Cost Comparison</h3>
          <span>{chartGasRow ? `N=${chartGasRow.records}` : "No chart row"}</span>
        </div>
        <DataNotice data={gasQuery.data} fallback="Run npm run gas:compare first" />

        <div className="gas-layout">
          <GasComparisonChart row={chartGasRow} />
          <div className="thesis-table-wrap">
            <table className="thesis-table">
              <thead>
                <tr>
                  <th>Records</th>
                  <th>Individual Storage Gas</th>
                  <th>Merkle Root Gas</th>
                  <th>Gas Saved</th>
                  <th>Savings %</th>
                </tr>
              </thead>
              <tbody>
                {gasRows.map((row) => (
                  <tr key={row.records}>
                    <td>{formatNumber(row.records)}</td>
                    <td>{formatNumber(row.individual_gas)}</td>
                    <td>{formatNumber(row.merkle_gas)}</td>
                    <td>{formatNumber(row.gas_saved)}</td>
                    <td>{formatGasPercent(row.savings_percent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="thesis-section card">
        <div className="thesis-section-head">
          <h3>Risk Score Distribution</h3>
          <span>{riskBuckets.reduce((sum, bucket) => sum + bucket.count, 0)} scored records</span>
        </div>
        <DataNotice data={riskQuery.data} fallback="Run npm run evaluate:risk first" />

        <div className="risk-bars">
          {riskBuckets.map((bucket) => (
            <div className={`risk-bar-row risk-${bucket.label.toLowerCase()}`} key={bucket.range}>
              <span>{bucket.range}</span>
              <div>
                <b style={{ width: `${(bucket.count / maxRiskBucketCount) * 100}%` }} />
              </div>
              <strong>{bucket.count}</strong>
              <em>{bucket.label}</em>
            </div>
          ))}
        </div>
      </div>

      <div className="thesis-section card">
        <div className="thesis-section-head">
          <h3>Oracle Performance</h3>
          <span>{oracleStats?.totalVerifications || 0} logs</span>
        </div>
        {oracleQuery.error ? <p className="error-text">{oracleQuery.error.message}</p> : null}

        <div className="thesis-metric-grid compact">
          <div>
            <span>Total Verifications</span>
            <strong>{oracleStats?.totalVerifications || 0}</strong>
          </div>
          <div>
            <span>Verified</span>
            <strong>{oracleStats?.verifiedCount || 0}</strong>
          </div>
          <div>
            <span>Failed</span>
            <strong>{oracleStats?.failedCount || 0}</strong>
          </div>
          <div>
            <span>Average Response</span>
            <strong>
              {oracleStats?.averageResponseTimeMs === null ||
              oracleStats?.averageResponseTimeMs === undefined
                ? "-"
                : `${oracleStats.averageResponseTimeMs} ms`}
            </strong>
          </div>
          <div>
            <span>Most Common Risk</span>
            <strong>{mostCommonRiskLevel?.riskLevel || "-"}</strong>
          </div>
        </div>
      </div>

      <div className="thesis-section card">
        <div className="thesis-section-head">
          <h3>Reserve Health</h3>
          <span>{reserve?.solvency?.status || "UNKNOWN"}</span>
        </div>
        {reserveQuery.error ? <p className="error-text">{reserveQuery.error.message}</p> : null}

        <div className="thesis-metric-grid compact">
          <div>
            <span>Reserve ETH</span>
            <strong>{formatEthValue(reserve?.reserve?.eth)} ETH</strong>
          </div>
          <div>
            <span>Open Exposure ETH</span>
            <strong>{formatEthValue(reserve?.liabilities?.openExposureEth)} ETH</strong>
          </div>
          <div>
            <span>Solvency Status</span>
            <strong>{reserve?.solvency?.status || "UNKNOWN"}</strong>
          </div>
          <div>
            <span>Reserve-to-Exposure</span>
            <strong>{formatRatio(reserve?.ratios?.reserveToOpenExposure)}</strong>
          </div>
        </div>
      </div>

      <div className="thesis-section card">
        <div className="thesis-section-head">
          <h3>Registry Merkle Commitment</h3>
          <span>{registrySnapshot?.committed ? "Committed" : "Not committed"}</span>
        </div>
        {registryQuery.error ? (
          <p className="error-text">{registryQuery.error.message}</p>
        ) : null}

        <div className="registry-commitment-grid">
          <div>
            <span>On-chain root hash</span>
            <strong>{registrySnapshot?.root || "-"}</strong>
          </div>
          <div>
            <span>Block number</span>
            <strong>{registrySnapshot?.blockNumber || "-"}</strong>
          </div>
          <div>
            <span>Timestamp</span>
            <strong>{formatTimestamp(registrySnapshot?.timestamp)}</strong>
          </div>
          <div>
            <span>Match status</span>
            <strong>
              {registrySnapshot?.committed ? "Root stored on-chain" : "No root stored"}
            </strong>
          </div>
        </div>
      </div>
    </section>
  );
}
