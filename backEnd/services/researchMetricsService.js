const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { eventIdentity, jsonSafe } = require("./blockchainIndexerService");

const readJsonIfPresent = (filePath) => {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
};

const readFiles = (directory, predicate) => {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) return readFiles(resolved, predicate);
    return predicate(resolved) ? [resolved] : [];
  });
};

const countTests = (directory) => readFiles(directory, (file) => /\.test\.js$/.test(file))
  .reduce((total, file) => total + (fs.readFileSync(file, "utf8").match(/\b(?:it|test)\s*\(/g) || []).length, 0);

const summarizeCoverage = (coverage) => {
  if (!coverage) return null;
  const counters = { statements: [], functions: [], lines: [], branches: [] };
  for (const file of Object.values(coverage)) {
    counters.statements.push(...Object.values(file.s || {}));
    counters.functions.push(...Object.values(file.f || {}));
    counters.lines.push(...Object.values(file.l || {}));
    counters.branches.push(...Object.values(file.b || {}).flat());
  }
  return Object.fromEntries(Object.entries(counters).map(([name, values]) => {
    const covered = values.filter((value) => Number(value) > 0).length;
    return [name, { covered, total: values.length, percent: values.length ? 100 * covered / values.length : 100 }];
  }));
};

const parseGasCsv = (filePath) => {
  try {
    const [header, ...lines] = fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/);
    const keys = header.split(",");
    return lines.map((line) => Object.fromEntries(line.split(",").map((value, index) => [keys[index], Number(value)])));
  } catch { return null; }
};

const benchmarkIndexer = () => {
  const events = Array.from({ length: 10000 }, (_, index) => ({
    address: "0x0000000000000000000000000000000000000001",
    transactionHash: `0x${index.toString(16).padStart(64, "0")}`,
    index: index % 32,
    args: { claimId: BigInt(index), blockNumber: BigInt(Math.floor(index / 32)) },
  }));
  const startedAt = performance.now();
  for (const event of events) {
    eventIdentity(event);
    jsonSafe(event.args);
  }
  const elapsedMs = performance.now() - startedAt;
  return { events: events.length, elapsedMs, eventsPerSecond: events.length / (elapsedMs / 1000) };
};

const calculateErrorRates = (matrix) => matrix ? {
  falseAcceptanceRate: matrix.falseNegative / Math.max(matrix.truePositive + matrix.falseNegative, 1),
  falseRejectionRate: matrix.falsePositive / Math.max(matrix.trueNegative + matrix.falsePositive, 1),
} : null;

const collectResearchMetrics = (projectRoot) => {
  const contractsRoot = path.join(projectRoot, "contracts");
  const backendRoot = path.join(projectRoot, "backEnd");
  const artifacts = [
    "InsuranceManager", "OracleCoordinator", "ClaimAdjudicator",
    "PolicyEconomics", "EvidenceRegistry", "PolicyBenefitsManager", "ProtocolDeploymentRegistry",
  ].map((name) => {
    const artifact = readJsonIfPresent(path.join(contractsRoot, "artifacts", "contracts", `${name}.sol`, `${name}.json`));
    return artifact ? { name, deployedBytes: (artifact.deployedBytecode.length - 2) / 2, eip170Limit: 24576 } : null;
  }).filter(Boolean);
  const phase5 = readJsonIfPresent(path.join(backendRoot, "evaluation-results", "phase5-evaluation.json"));
  const throughput = readJsonIfPresent(path.join(backendRoot, "evaluation-results", "claim-throughput-results.json"));
  const oracleLatency = readJsonIfPresent(path.join(backendRoot, "evaluation-results", "oracle-decision-latency.json"));
  const temporalMatrix = phase5?.temporalHoldout?.metrics?.confusionMatrix;
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    testInventory: {
      solidity: countTests(path.join(contractsRoot, "test")),
      backend: countTests(path.join(backendRoot, "test")),
      oracle: countTests(path.join(projectRoot, "oracle", "test")),
      note: "Static test declarations; runtime pass counts are emitted by npm run verify:all.",
    },
    coverage: summarizeCoverage(readJsonIfPresent(path.join(contractsRoot, "coverage.json"))),
    contractSizes: artifacts,
    gasPerWorkflow: parseGasCsv(path.join(contractsRoot, "gas-comparison-results.csv")),
    modelMetrics: phase5?.confidenceIntervals || null,
    temporalModelMetrics: phase5?.temporalHoldout?.metrics || null,
    classificationErrors: calculateErrorRates(temporalMatrix),
    inferencePerformance: phase5?.performance || null,
    oracleDecisionLatency: oracleLatency || {
      available: false,
      reason: "Requires a running local deployment and finalized OracleLog records",
      collectionCommand: "npm --prefix backEnd run demo:populate",
    },
    attackMetrics: phase5?.attackMetrics || null,
    indexingPerformance: {
      pureDecodeBenchmark: benchmarkIndexer(),
      persistedIndexer: throughput?.indexing || null,
    },
    workflowPerformance: throughput || null,
    evidenceProofCosts: phase5?.evidenceProofCosts || null,
  };
};

module.exports = { collectResearchMetrics, summarizeCoverage };
