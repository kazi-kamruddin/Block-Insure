import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  getEvaluationSummary,
  getGasComparison,
  getOnChainRegistryMerkleRoot,
  getOracleStats,
  getReserveIntelligence,
  getRiskDistribution,
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

  const summary = extractSummary(summaryQuery.data);
  const gasRows = extractRows(gasQuery.data);
  const riskBuckets = extractRiskBuckets(riskQuery.data);
  const oracleStats = extractOracleStats(oracleQuery.data);
  const reserve = extractReserveIntelligence(reserveQuery.data);
  const registrySnapshot = extractRegistrySnapshot(registryQuery.data);
  const chartGasRow = getGasRowForChart(gasRows);
  const maxRiskBucketCount = Math.max(
    ...riskBuckets.map((bucket) => bucket.count),
    1
  );
  const riskLevelRows = useMemo(
    () =>
      ["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((level) => [
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
    registryQuery.isLoading;

  function refreshAll() {
    summaryQuery.refetch();
    gasQuery.refetch();
    riskQuery.refetch();
    oracleQuery.refetch();
    reserveQuery.refetch();
    registryQuery.refetch();
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
          <span>{summary?.dataset?.totalRecords || 0} registry records</span>
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
