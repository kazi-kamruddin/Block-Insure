const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "paper-evidence");
const TABLE_DIR = path.join(OUTPUT_DIR, "tables");
const FIGURE_DIR = path.join(OUTPUT_DIR, "figures");

const readJson = (relativePath) => JSON.parse(
  fs.readFileSync(path.join(ROOT, relativePath), "utf8")
);
const readText = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");
const sha256File = (relativePath) => crypto
  .createHash("sha256")
  .update(fs.readFileSync(path.join(ROOT, relativePath)))
  .digest("hex");
const round = (value, decimals = 6) => Number(Number(value).toFixed(decimals));
const percent = (value, decimals = 2) => `${(Number(value) * 100).toFixed(decimals)}%`;
const escapeCsv = (value) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const writeCsv = (fileName, rows) => {
  if (!rows.length) throw new Error(`Cannot write empty paper table ${fileName}`);
  const headers = Object.keys(rows[0]);
  const content = [
    headers.map(escapeCsv).join(","),
    ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(",")),
  ].join("\n");
  fs.writeFileSync(path.join(TABLE_DIR, fileName), `${content}\n`);
};

const parseCsv = (text) => {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(",");
  return lines.map((line) => Object.fromEntries(
    line.split(",").map((value, index) => [headers[index], Number(value)])
  ));
};

const parseCoverageSummary = (html) => {
  const values = [...html.matchAll(/<span class="strong">([0-9.]+)%\s*<\/span>\s*<span class="quiet">(Statements|Branches|Functions|Lines)<\/span>/g)];
  if (values.length !== 4) throw new Error("Unable to parse Solidity coverage summary");
  return Object.fromEntries(values.map((match) => [match[2].toLowerCase(), Number(match[1])]));
};

const svgEscape = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

const barChartSvg = ({ title, subtitle, rows, valueKey, valueLabel, maximum = 1 }) => {
  const width = 1120;
  const rowHeight = 74;
  const height = 170 + rows.length * rowHeight;
  const chartX = 390;
  const chartWidth = 610;
  const colors = ["#1d4ed8", "#0f766e", "#7c3aed", "#c2410c", "#be123c"];
  const rowSvg = rows.map((row, index) => {
    const y = 135 + index * rowHeight;
    const value = Number(row[valueKey]);
    const barWidth = Math.max(0, Math.min(chartWidth, value / maximum * chartWidth));
    return `
      <text x="42" y="${y + 26}" class="label">${svgEscape(row.label)}</text>
      <rect x="${chartX}" y="${y}" width="${chartWidth}" height="38" rx="6" fill="#e2e8f0"/>
      <rect x="${chartX}" y="${y}" width="${barWidth}" height="38" rx="6" fill="${colors[index % colors.length]}"/>
      <text x="${Math.min(chartX + barWidth + 12, width - 92)}" y="${y + 26}" class="value">${svgEscape(valueLabel(value))}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${svgEscape(title)}">
    <style>
      .title { font: 700 28px Arial, sans-serif; fill: #0f172a; }
      .subtitle { font: 16px Arial, sans-serif; fill: #475569; }
      .label { font: 17px Arial, sans-serif; fill: #0f172a; }
      .value { font: 700 16px Arial, sans-serif; fill: #0f172a; }
    </style>
    <rect width="100%" height="100%" fill="#ffffff"/>
    <text x="42" y="48" class="title">${svgEscape(title)}</text>
    <text x="42" y="78" class="subtitle">${svgEscape(subtitle)}</text>
    ${rowSvg}
  </svg>\n`;
};

const main = () => {
  fs.mkdirSync(TABLE_DIR, { recursive: true });
  fs.mkdirSync(FIGURE_DIR, { recursive: true });

  const manifest = readJson("backEnd/datasets/hybrid-v1/manifest.json");
  const hybrid = readJson("backEnd/evaluation-results/hybrid-v1-evaluation.json");
  const benchmark = readJson("backEnd/evaluation-results/hybrid-runtime-benchmark.json");
  const reserve = readJson("backEnd/evaluation-results/phase3-reserve-evaluation.json");
  const evidence = readJson("backEnd/evaluation-results/phase4-evidence-evaluation.json");
  const mutation = readJson("contracts/mutation-results.json");
  const verification = readJson("verification-results/phase5-verification.json");
  const liveValidation = readJson("paper-evidence/live-validation.json");
  const throughput = readJson("backEnd/evaluation-results/claim-throughput-results.json");
  const researchMetrics = readJson("backEnd/evaluation-results/research-metrics.json");
  const gasRows = parseCsv(readText("contracts/gas-comparison-results.csv"));
  const contractCoverage = parseCoverageSummary(readText("contracts/coverage/index.html"));
  const primary = hybrid.providerRisk.testMetrics;
  const providerModels = [
    {
      key: "bernoulli_nb_primary",
      label: "Bernoulli NB (frozen primary)",
      algorithm: "BernoulliNB",
      threshold: hybrid.providerRisk.modelArtifact.threshold,
      metrics: primary,
    },
    ...hybrid.providerRisk.baselines.map((baseline) => ({
      key: baseline.key,
      label: baseline.label,
      algorithm: baseline.algorithm,
      threshold: baseline.threshold,
      metrics: baseline.testMetrics,
    })),
  ];
  const routing = Object.entries(hybrid.controlledAttacks.routingAblation).map(([key, value]) => ({
    key,
    label: value.label,
    ...value,
  }));
  const scenarioNames = Object.keys(hybrid.controlledAttacks.scenarioDetection).sort();

  const evidencePack = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: verification.passed ? "FROZEN_INPUTS_VERIFIED" : "VERIFICATION_FAILED",
    terminology: {
      providerPotentialFraud: "Weak provider-level audit-prioritization label; not confirmed claim fraud",
      controlledAttackTruth: "Claim-level ground truth only for deterministic Block-Insure attack injection",
      untouchedEscalation: "Routing to review; not a fraud conviction",
      datasetDescription: "Public-secondary Medicare claims benchmark plus controlled protocol attacks",
    },
    dataset: {
      version: manifest.datasetVersion,
      sourceClaims: manifest.totalUniqueClaims,
      providers: manifest.providers,
      beneficiaries: manifest.beneficiaries,
      inpatientClaims: manifest.sourceCounts.INPATIENT,
      outpatientClaims: manifest.sourceCounts.OUTPATIENT,
      trainClaims: manifest.counts.train,
      calibrationClaims: manifest.counts.calibration,
      testClaims: manifest.counts.testUntouched,
      pairedInjectedAttacks: manifest.counts.injectedByPartition.testAttacks,
      runtimeRecords: benchmark.runtimeRecords,
      runtimeRealDerivedRecords: benchmark.hybridRecords,
      runtimeCompatibilityPresets: benchmark.preservedDemoRecords,
      splitPolicy: manifest.splitPolicy,
      beneficiaryOverlap: manifest.beneficiaryOverlap,
    },
    providerRisk: {
      model: hybrid.providerRisk.modelArtifact,
      partitions: hybrid.providerRisk.partitions,
      testMetrics: primary,
      confidenceIntervals: hybrid.providerRisk.confidenceIntervals,
      baselines: hybrid.providerRisk.baselines,
      featureGroupAblation: hybrid.providerRisk.featureGroupAblation,
      interpretation: "Ranking is useful, but the frozen operating threshold has moderate recall and F1; conventional logistic comparators perform better on several test metrics.",
    },
    controlledRouting: {
      threshold: hybrid.controlledAttacks.routingThreshold,
      untouchedEscalationRate: hybrid.controlledAttacks.untouchedEscalationRate,
      attackRoutingRecall: hybrid.controlledAttacks.controlledAttackRoutingRecall,
      pairedMetrics: hybrid.controlledAttacks.pairedAttackMetrics,
      meanInjectedProbabilityIncrease: hybrid.controlledAttacks.meanInjectedProbabilityIncrease,
      scenarioDetection: hybrid.controlledAttacks.scenarioDetection,
      ablation: hybrid.controlledAttacks.routingAblation,
    },
    runtimeRegistry: benchmark,
    reserve: {
      methodology: reserve.methodology,
      scenarios: reserve.scenarios.map((scenario) => ({
        key: scenario.key,
        currentFivePercentPolicy: scenario.currentFivePercentPolicy,
        recommendedCapitalRatio: scenario.recommendedCapitalRatio,
      })),
    },
    confidentialEvidence: {
      methodology: evidence.methodology,
      documentBenchmarks: evidence.documentBenchmarks,
      proxyReEncryptionBenchmarks: evidence.preBenchmarks,
      identityLifecycle: evidence.identityLifecycle,
      proofBenchmarks: evidence.proofBenchmarks,
      adversarialTests: evidence.adversarialTests,
      authorityBoundary: evidence.authorityBoundary,
      limitations: evidence.limitations,
    },
    assurance: {
      fullVerificationPassed: verification.passed,
      verificationGeneratedAt: verification.generatedAt,
      tasks: verification.tasks,
      mutationSummary: mutation.summary,
      contractCoveragePercent: contractCoverage,
      contractSizes: researchMetrics.contractSizes,
      liveValidation,
    },
    performance: {
      gasComparison: gasRows,
      throughput: throughput.rows.map(({ samples, failures, ...row }) => ({
        ...row,
        failureCount: failures.length,
      })),
      throughputWarning: "The 50-claim local automining run encountered nonce-queue failures and is a saturation observation, not production throughput.",
    },
    sourceArtifacts: {
      hybridManifest: sha256File("backEnd/datasets/hybrid-v1/manifest.json"),
      hybridEvaluation: sha256File("backEnd/evaluation-results/hybrid-v1-evaluation.json"),
      runtimeBenchmark: sha256File("backEnd/evaluation-results/hybrid-runtime-benchmark.json"),
      reserveEvaluation: sha256File("backEnd/evaluation-results/phase3-reserve-evaluation.json"),
      evidenceEvaluation: sha256File("backEnd/evaluation-results/phase4-evidence-evaluation.json"),
      mutationResults: sha256File("contracts/mutation-results.json"),
      verification: sha256File("verification-results/phase5-verification.json"),
      liveValidation: sha256File("paper-evidence/live-validation.json"),
    },
  };
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "paper-metrics.json"),
    `${JSON.stringify(evidencePack, null, 2)}\n`
  );

  writeCsv("dataset-summary.csv", [
    { partition: "train", claims: manifest.counts.train, providers: hybrid.providerRisk.partitions.train.providers },
    { partition: "calibration", claims: manifest.counts.calibration, providers: hybrid.providerRisk.partitions.calibration.providers },
    { partition: "test_untouched", claims: manifest.counts.testUntouched, providers: hybrid.providerRisk.partitions.test.providers },
    { partition: "test_paired_attacks", claims: manifest.counts.testAttacks, providers: hybrid.providerRisk.partitions.test.providers },
    { partition: "runtime_registry", claims: benchmark.runtimeRecords, providers: "not_applicable" },
  ]);
  writeCsv("provider-model-comparison.csv", providerModels.map((model) => ({
    key: model.key,
    model: model.label,
    algorithm: model.algorithm,
    threshold: model.threshold,
    accuracy: model.metrics.accuracy,
    precision: model.metrics.precision,
    recall: model.metrics.recall,
    f1: model.metrics.f1Score,
    mcc: model.metrics.matthewsCorrelationCoefficient,
    roc_auc: model.metrics.rocAuc,
    pr_auc: model.metrics.prAuc,
    brier: model.metrics.brierScore,
    ece: model.metrics.calibrationError,
  })));
  writeCsv("provider-confidence-intervals.csv", Object.entries(
    hybrid.providerRisk.confidenceIntervals.metrics
  ).map(([metric, interval]) => ({ metric, ...interval })));
  writeCsv("provider-feature-group-ablation.csv", hybrid.providerRisk.featureGroupAblation.map((row) => ({
    experiment: row.key,
    removed_features: row.removedFeatures.join(";"),
    threshold: row.threshold,
    roc_auc: row.testMetrics.rocAuc,
    pr_auc: row.testMetrics.prAuc,
    f1: row.testMetrics.f1Score,
    delta_roc_auc: row.deltaFromPrimary.rocAuc,
    delta_pr_auc: row.deltaFromPrimary.prAuc,
    delta_f1: row.deltaFromPrimary.f1Score,
  })));
  writeCsv("routing-ablation.csv", routing.map((row) => ({
    strategy: row.key,
    label: row.label,
    untouched_escalation_rate: row.untouchedEscalationRate,
    controlled_attack_recall: row.controlledAttackRoutingRecall,
    precision: row.pairedAttackMetrics.precision,
    f1: row.pairedAttackMetrics.f1Score,
    mcc: row.pairedAttackMetrics.matthewsCorrelationCoefficient,
  })));
  writeCsv("controlled-attack-scenarios.csv", scenarioNames.map((scenario) => ({
    scenario,
    records: hybrid.controlledAttacks.scenarioDetection[scenario].records,
    model_only_recall: hybrid.controlledAttacks.routingAblation.model_only.scenarioRecall[scenario],
    rules_only_recall: hybrid.controlledAttacks.routingAblation.integrity_rules_only.scenarioRecall[scenario],
    combined_recall: hybrid.controlledAttacks.routingAblation.combined.scenarioRecall[scenario],
  })));
  writeCsv("reserve-stress.csv", reserve.scenarios.map((scenario) => ({
    scenario: scenario.key,
    five_percent_shortfall_probability: scenario.currentFivePercentPolicy.shortfallProbability,
    five_percent_expected_shortfall_eth: scenario.currentFivePercentPolicy.expectedShortfallEth,
    recommended_capital_ratio: scenario.recommendedCapitalRatio,
    target_met: scenario.targetMet,
  })));
  writeCsv("registry-gas-comparison.csv", gasRows);
  writeCsv("runtime-throughput.csv", throughput.rows.map((row) => ({
    concurrency: row.concurrency,
    attempted_claims: row.attemptedClaims,
    successful_claims: row.successfulClaims,
    failed_claims: row.failedClaims,
    throughput_claims_per_second: row.throughputClaimsPerSecond,
    backend_average_ms: row.backend.averageMs,
    blockchain_average_ms: row.blockchain.averageMs,
    end_to_end_average_ms: row.endToEnd.averageMs,
    end_to_end_p95_ms: row.endToEnd.p95Ms,
  })));
  writeCsv("verification-summary.csv", verification.tasks.map((task) => ({
    task: task.key,
    passed: task.passed,
    duration_ms: task.durationMs,
  })));
  writeCsv("contract-coverage.csv", Object.entries(contractCoverage).map(([metric, percentage]) => ({
    metric,
    percentage,
  })));
  writeCsv("live-validation.csv", liveValidation.suites.map((suite) => ({
    suite: suite.key,
    passed: suite.passed,
    failed: suite.failed,
    duration_seconds: suite.durationSeconds,
    scope: suite.scope,
  })));
  writeCsv("evidence-document-latency.csv", evidence.documentBenchmarks.map((row) => ({
    document: row.key,
    bytes: row.bytes,
    ciphertext_expansion_bytes: row.ciphertextExpansionBytes,
    aes_encrypt_p50_ms: row.aesEncrypt.p50Ms,
    aes_encrypt_p95_ms: row.aesEncrypt.p95Ms,
    aes_decrypt_p50_ms: row.aesDecrypt.p50Ms,
    aes_decrypt_p95_ms: row.aesDecrypt.p95Ms,
    local_store_p95_ms: row.localContentPut.p95Ms,
    local_retrieve_p95_ms: row.localContentGet.p95Ms,
  })));
  writeCsv("evidence-proxy-reencryption.csv", evidence.preBenchmarks.map((row) => ({
    recipients: row.recipientCount,
    capsule_bytes: row.capsuleBytes,
    transformation_p50_ms: row.transformations.p50Ms,
    transformation_p95_ms: row.transformations.p95Ms,
    recipient_decryption_p50_ms: row.recipientDecryptions.p50Ms,
    recipient_decryption_p95_ms: row.recipientDecryptions.p95Ms,
  })));
  writeCsv("evidence-merkle-proofs.csv", evidence.proofBenchmarks.map((row) => ({
    tree_size: row.treeSize,
    proof_nodes: row.proofNodes,
    proof_bytes: row.proofBytes,
    build_and_prove_p50_ms: row.buildAndProve.p50Ms,
    build_and_prove_p95_ms: row.buildAndProve.p95Ms,
    verify_p50_ms: row.verify.p50Ms,
    verify_p95_ms: row.verify.p95Ms,
  })));
  writeCsv("contract-sizes.csv", researchMetrics.contractSizes.map((row) => ({
    contract: row.name,
    deployed_bytes: row.deployedBytes,
    eip170_limit: row.eip170Limit,
    headroom_bytes: row.eip170Limit - row.deployedBytes,
  })));

  fs.writeFileSync(path.join(FIGURE_DIR, "provider-model-comparison.svg"), barChartSvg({
    title: "Provider-risk model comparison",
    subtitle: "Provider-disjoint test ROC-AUC; PotentialFraud is a weak provider label",
    rows: providerModels.map((model) => ({ label: model.label, value: model.metrics.rocAuc })),
    valueKey: "value",
    valueLabel: (value) => value.toFixed(4),
  }));
  fs.writeFileSync(path.join(FIGURE_DIR, "routing-ablation.svg"), barChartSvg({
    title: "Controlled-attack routing ablation",
    subtitle: "Recall across 54,705 deterministic injected attacks",
    rows: routing.map((row) => ({ label: row.label, value: row.controlledAttackRoutingRecall })),
    valueKey: "value",
    valueLabel: (value) => percent(value),
  }));
  fs.writeFileSync(path.join(FIGURE_DIR, "provider-feature-ablation.svg"), barChartSvg({
    title: "Provider feature-group ablation",
    subtitle: "Provider-disjoint test ROC-AUC after removing each feature group",
    rows: [
      { label: "All features", value: primary.rocAuc },
      ...hybrid.providerRisk.featureGroupAblation.map((row) => ({
        label: row.label,
        value: row.testMetrics.rocAuc,
      })),
    ],
    valueKey: "value",
    valueLabel: (value) => value.toFixed(4),
  }));
  fs.writeFileSync(path.join(FIGURE_DIR, "reserve-stress.svg"), barChartSvg({
    title: "Shortfall probability under the fixed 5% reserve",
    subtitle: "Seeded advisory Monte Carlo experiment; not a solvency calculation",
    rows: reserve.scenarios.map((scenario) => ({
      label: scenario.label,
      value: scenario.currentFivePercentPolicy.shortfallProbability,
    })),
    valueKey: "value",
    valueLabel: (value) => percent(value),
  }));

  console.log(`Paper evidence written to ${OUTPUT_DIR}`);
  console.log(`Primary provider ROC-AUC: ${primary.rocAuc}`);
  console.log(`Combined controlled-attack recall: ${hybrid.controlledAttacks.controlledAttackRoutingRecall}`);
};

if (require.main === module) main();

module.exports = { barChartSvg, main, parseCoverageSummary, parseCsv };
