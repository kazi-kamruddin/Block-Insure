require("dotenv").config();

const dns = require("dns");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const MockHospitalRecord = require("../models/MockHospitalRecord");
const { buildVerificationComparison } = require("../controllers/mockHospitalController");
const {
  calculateBaselines,
  calculateClassificationMetrics,
  calculateCurves,
  calculateThresholdSensitivity,
  getThresholdPoint,
  selectBestThreshold,
} = require("../services/evaluationMetricsService");
const { trainModelParams } = require("../services/modelTrainingService");
const { buildRiskAssessment } = require("../services/riskScoringService");
const { buildSyntheticRecords } = require("./seedMockData");

dns.setDefaultResultOrder("ipv4first");

if (process.env.FORCE_PUBLIC_DNS === "true") {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
}

const RESULTS_DIR = path.join(__dirname, "..", "evaluation-results");

const formatDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

const addDays = (value, days) => {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
};

const round = (value, decimals = 4) => {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(decimals));
};

const isFraudRecord = (record) => record.fraudLabel !== "LEGITIMATE";

const getRiskBucket = (score) => {
  if (score >= 70) return "HIGH";
  if (score >= 35) return "MEDIUM";
  return "LOW";
};

const toCsvValue = (value) => {
  if (value === undefined || value === null) return "";
  const text = String(value);

  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
};

const writeCsv = (filePath, rows) => {
  if (rows.length === 0) {
    fs.writeFileSync(filePath, "", "utf8");
    return;
  }

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => toCsvValue(row[header])).join(",")),
  ];

  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
};

const createEmptyLabelStats = () => ({
  total: 0,
  predictedFraud: 0,
  avgRiskScoreTotal: 0,
});

const applyThreshold = (rows, threshold) => {
  return rows.map((row) => ({
    ...row,
    predictedFraud: row.riskScore >= threshold,
    verified: row.riskScore < threshold,
  }));
};

const buildBaseQuery = (record) => ({
  hospitalId: record.hospitalId,
  invoiceHash: record.invoiceHash,
  claimAmountEth: record.billAmount,
  claimType: record.treatmentType,
  incidentDate: formatDate(record.admissionDate),
});

const scaleAmount = (value, multiplier) => {
  return (Number(value) * multiplier).toFixed(2);
};

const sanitizeAsSubtleFraud = (record) => ({
  ...record,
  fraudLabel: "LEGITIMATE",
  recordStatus: "VALID",
  invoiceStatus: "VALID",
  licenseStatus: "ACTIVE",
  billAmount: record.expectedBillMax || record.billAmount,
  previousClaimCount: 0,
  fraudSignals: {
    usedInvoice: false,
    cancelledRecord: false,
    inflatedAmount: false,
    blacklistedHospital: false,
    dateMismatch: false,
  },
});

const buildEvaluationScenarios = (records, { includeHardCases = true } = {}) => {
  const scenarios = [];

  records.forEach((record, index) => {
    const actualFraud = isFraudRecord(record);
    const baseQuery = buildBaseQuery(record);
    const scenarioBase = {
      scenarioId: `${record.invoiceNumber || record.invoiceHash}-${index}`,
      hospitalId: record.hospitalId,
      invoiceNumber: record.invoiceNumber,
      treatmentType: record.treatmentType,
      registryRecord: record,
    };

    scenarios.push({
      ...scenarioBase,
      scenarioType: actualFraud ? "obvious_fraud_registry_marker" : "clean_legitimate_match",
      fraudLabel: record.fraudLabel,
      actualFraud,
      query: baseQuery,
    });

    if (!includeHardCases) {
      return;
    }

    if (!actualFraud && index % 3 === 0) {
      scenarios.push({
        ...scenarioBase,
        scenarioId: `${scenarioBase.scenarioId}-noisy-amount`,
        scenarioType: "noisy_legitimate_amount_rounding",
        fraudLabel: "LEGITIMATE",
        actualFraud: false,
        query: {
          ...baseQuery,
          claimAmountEth: scaleAmount(record.billAmount, 1.08),
        },
      });
    }

    if (!actualFraud && index % 5 === 0) {
      scenarios.push({
        ...scenarioBase,
        scenarioId: `${scenarioBase.scenarioId}-date-warning`,
        scenarioType: "borderline_legitimate_date_noise",
        fraudLabel: "LEGITIMATE",
        actualFraud: false,
        query: {
          ...baseQuery,
          incidentDate: formatDate(addDays(record.admissionDate, 9)),
        },
      });
    }

    if (actualFraud && index % 4 === 0) {
      scenarios.push({
        ...scenarioBase,
        scenarioId: `${scenarioBase.scenarioId}-subtle-fraud`,
        scenarioType: "subtle_fraud_no_registry_marker",
        fraudLabel: "SUBTLE_SYNTHETIC_FRAUD",
        actualFraud: true,
        registryRecord: sanitizeAsSubtleFraud(record),
        query: {
          ...baseQuery,
          claimAmountEth: record.expectedBillMax || record.billAmount,
        },
      });
    }
  });

  return scenarios;
};

const calculateMetrics = ({
  rows,
  split,
  selectedThreshold,
  curves,
  baselines,
  thresholdSelection,
  heldOutSensitivity,
}) => {
  const thresholdPoint = getThresholdPoint(rows, selectedThreshold);
  const confusionMatrix = {
    truePositive: thresholdPoint.truePositive,
    trueNegative: thresholdPoint.trueNegative,
    falsePositive: thresholdPoint.falsePositive,
    falseNegative: thresholdPoint.falseNegative,
  };
  const classificationMetrics = calculateClassificationMetrics(confusionMatrix);
  const riskBuckets = {
    LOW: 0,
    MEDIUM: 0,
    HIGH: 0,
  };
  const labelBreakdown = {};
  const scenarioTypeBreakdown = {};
  let riskScoreTotal = 0;

  rows.forEach((row) => {
    riskBuckets[row.riskBucket] += 1;
    riskScoreTotal += row.riskScore;

    if (!labelBreakdown[row.fraudLabel]) {
      labelBreakdown[row.fraudLabel] = createEmptyLabelStats();
    }

    labelBreakdown[row.fraudLabel].total += 1;
    labelBreakdown[row.fraudLabel].predictedFraud += row.predictedFraud ? 1 : 0;
    labelBreakdown[row.fraudLabel].avgRiskScoreTotal += row.riskScore;

    if (!scenarioTypeBreakdown[row.scenarioType]) {
      scenarioTypeBreakdown[row.scenarioType] = {
        total: 0,
        fraud: 0,
        predictedFraud: 0,
      };
    }

    scenarioTypeBreakdown[row.scenarioType].total += 1;
    scenarioTypeBreakdown[row.scenarioType].fraud += row.actualFraud ? 1 : 0;
    scenarioTypeBreakdown[row.scenarioType].predictedFraud += row.predictedFraud
      ? 1
      : 0;
  });

  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    dataset: {
      unit: "held-out claim scenarios",
      evaluationScenarios: rows.length,
      // Retained for compatibility with existing dashboard consumers.
      totalRecords: rows.length,
      legitimateRecords: rows.filter((row) => !row.actualFraud).length,
      fraudRecords: rows.filter((row) => row.actualFraud).length,
      fraudRate: curves.fraudPrevalence,
    },
    split,
    statisticalMethodology: {
      variance: "Sample variance with Bessel's correction (N-1)",
      thresholdSelection:
        "Selected on deterministic training claim scenarios by maximum F1, then applied once to held-out claim scenarios",
      evaluationScope:
        "Primary metrics, ROC, AUC, precision-recall curve, AP, and baselines use held-out claim scenarios only",
      hardCaseDesign:
        "The scenario set includes exact registry matches, noisy legitimate claims, and subtle synthetic fraud cases with weak registry markers.",
    },
    decisionRule: {
      predictedFraud: `posterior fraud risk score >= ${selectedThreshold}`,
      selectedThreshold,
      selectedFrom: "Training-split threshold sensitivity",
      selectionReason: `Maximum training F1 (${thresholdSelection.f1Score})`,
      riskBucket: "LOW < 35, MEDIUM 35-69, HIGH >= 70",
    },
    confusionMatrix,
    metrics: {
      ...classificationMetrics,
      auc: curves.auc,
      averagePrecision: curves.averagePrecision,
      averageRiskScore: round(riskScoreTotal / Math.max(rows.length, 1), 2),
    },
    baselines,
    thresholdAnalysis: {
      selected: thresholdSelection,
      heldOutBestObserved: selectBestThreshold(heldOutSensitivity),
      heldOutSensitivity,
      note:
        "The held-out best threshold is reported for sensitivity analysis only and is not used to calculate primary metrics.",
    },
    curves,
    riskBuckets,
    fraudLabelBreakdown: Object.fromEntries(
      Object.entries(labelBreakdown).map(([label, stats]) => [
        label,
        {
          total: stats.total,
          predictedFraud: stats.predictedFraud,
          detectionRate: round(stats.predictedFraud / Math.max(stats.total, 1)),
          averageRiskScore: round(
            stats.avgRiskScoreTotal / Math.max(stats.total, 1),
            2
          ),
        },
      ])
    ),
    scenarioTypeBreakdown,
  };
};

const evaluateScenario = async (scenario, trainingRecords, modelParams) => {
  const record = scenario.registryRecord;
  const query = scenario.query;
  const comparison = buildVerificationComparison({
    record,
    hospitalId: query.hospitalId,
    invoiceHash: query.invoiceHash,
    claimAmountEth: query.claimAmountEth,
    claimType: query.claimType,
    incidentDate: query.incidentDate,
  });
  const riskAssessment = await buildRiskAssessment({
    record,
    comparison,
    query,
    records: trainingRecords,
    modelParams,
  });

  return {
    scenarioId: scenario.scenarioId,
    scenarioType: scenario.scenarioType,
    hospitalId: record.hospitalId,
    invoiceNumber: record.invoiceNumber,
    treatmentType: record.treatmentType,
    fraudLabel: scenario.fraudLabel,
    actualFraud: scenario.actualFraud,
    claimAmountEth: Number(query.claimAmountEth),
    registryBillAmountEth: Number(record.billAmount),
    riskScore: riskAssessment.riskScore,
    posteriorFraudPercent: riskAssessment.posteriorFraudPercent,
    riskBucket: getRiskBucket(riskAssessment.riskScore),
    recommendation: riskAssessment.recommendation,
    matchScore: comparison.matchScore,
    blockingFailureCount: comparison.blockingFailureCount,
    warningFailureCount: comparison.warningFailureCount,
    activeEvidenceCount: riskAssessment.activeEvidenceCount,
    topRiskDrivers: riskAssessment.riskDrivers
      .map((driver) => driver.label)
      .join(" | "),
    amountZScore: riskAssessment.anomalySignals.amountZScore.zScore,
    repeatClaimZScore: riskAssessment.anomalySignals.repeatClaimZScore.zScore,
  };
};

const evaluateRecord = async (record, trainingRecords, modelParams) => {
  return evaluateScenario(
    {
      scenarioId: record.invoiceNumber || record.invoiceHash,
      scenarioType: isFraudRecord(record)
        ? "obvious_fraud_registry_marker"
        : "clean_legitimate_match",
      fraudLabel: record.fraudLabel,
      actualFraud: isFraudRecord(record),
      registryRecord: record,
      query: buildBaseQuery(record),
    },
    trainingRecords,
    modelParams
  );
};

const scoreScenarios = async (scenarios, trainingRecords, modelParams) => {
  const rows = [];

  for (const scenario of scenarios) {
    rows.push(await evaluateScenario(scenario, trainingRecords, modelParams));
  }

  return rows;
};

const scoreRecords = async (records, trainingRecords, modelParams) => {
  return scoreScenarios(
    buildEvaluationScenarios(records, { includeHardCases: false }),
    trainingRecords,
    modelParams
  );
};

const getEvaluationRecords = async ({ useSynthetic }) => {
  if (useSynthetic) {
    return {
      records: buildSyntheticRecords().sort(
        (left, right) =>
          left.hospitalId.localeCompare(right.hospitalId) ||
          left.invoiceNumber.localeCompare(right.invoiceNumber)
      ),
      source: "Deterministic synthetic seed generated in memory",
      close: async () => {},
    };
  }

  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing in .env");
  }

  await mongoose.connect(process.env.MONGODB_URI);

  return {
    records: await MockHospitalRecord.find()
      .sort({ hospitalId: 1, invoiceNumber: 1 })
      .lean(),
    source: "MongoDB MockHospitalRecord collection",
    close: async () => mongoose.connection.close(),
  };
};

const writeEvaluationOutputs = ({
  summary,
  modelParams,
  heldOutRows,
  trainingSensitivity,
  heldOutSensitivity,
}) => {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RESULTS_DIR, "risk-model-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(RESULTS_DIR, "evaluation-model-params.json"),
    `${JSON.stringify(modelParams, null, 2)}\n`,
    "utf8"
  );
  writeCsv(path.join(RESULTS_DIR, "risk-model-records.csv"), heldOutRows);
  writeCsv(path.join(RESULTS_DIR, "baseline-comparison.csv"), summary.baselines.map(
    (baseline) => ({
      baseline: baseline.label,
      thresholdValue: baseline.thresholdValue,
      accuracy: baseline.metrics.accuracy,
      precision: baseline.metrics.precision,
      recall: baseline.metrics.recall,
      f1Score: baseline.metrics.f1Score,
    })
  ));
  writeCsv(path.join(RESULTS_DIR, "roc-curve.csv"), summary.curves.roc);
  writeCsv(
    path.join(RESULTS_DIR, "precision-recall-curve.csv"),
    summary.curves.precisionRecall
  );
  writeCsv(path.join(RESULTS_DIR, "threshold-sensitivity.csv"), heldOutSensitivity);
  writeCsv(
    path.join(RESULTS_DIR, "threshold-selection-training.csv"),
    trainingSensitivity
  );
};

const runEvaluation = async ({ useSynthetic = false, writeOutputs = true } = {}) => {
  const source = await getEvaluationRecords({ useSynthetic });

  try {
    if (source.records.length === 0) {
      throw new Error("No synthetic registry records found. Run npm run seed:mock first.");
    }

    const trainingRecords = source.records.filter((_, index) => index % 5 !== 0);
    const testRecords = source.records.filter((_, index) => index % 5 === 0);
    const trainingScenarios = buildEvaluationScenarios(trainingRecords);
    const testScenarios = buildEvaluationScenarios(testRecords);
    const modelParams = trainModelParams(trainingRecords, {
      source: "Deterministic 80% evaluation training split",
    });
    const trainingRows = await scoreScenarios(
      trainingScenarios,
      trainingRecords,
      modelParams
    );
    const trainingSensitivity = calculateThresholdSensitivity(trainingRows);
    const thresholdSelection = selectBestThreshold(trainingSensitivity);
    const selectedThreshold = thresholdSelection.threshold;
    const rawHeldOutRows = await scoreScenarios(
      testScenarios,
      trainingRecords,
      modelParams
    );
    const heldOutRows = applyThreshold(rawHeldOutRows, selectedThreshold);
    const curves = calculateCurves(heldOutRows);
    const heldOutSensitivity = calculateThresholdSensitivity(heldOutRows);
    const meanTrainingClaimAmount =
      trainingRecords.reduce(
        (total, record) => total + Number(record.billAmount),
        0
      ) / trainingRecords.length;
    const baselines = calculateBaselines(heldOutRows, meanTrainingClaimAmount);
    const summary = calculateMetrics({
      rows: heldOutRows,
      split: {
        method: "Deterministic 80/20 split after stable hospital/invoice sort",
        source: source.source,
        trainingRecords: trainingRecords.length,
        testRecords: testRecords.length,
        trainingScenarios: trainingScenarios.length,
        testScenarios: testScenarios.length,
        trainingPercent: round(trainingRecords.length / source.records.length),
        testPercent: round(testRecords.length / source.records.length),
        evaluationScope:
          "Metrics are calculated on deterministic held-out claim scenarios, including noisy legitimate and subtle fraud cases",
        modelVersion: modelParams.modelVersion,
      },
      selectedThreshold,
      curves,
      baselines,
      thresholdSelection,
      heldOutSensitivity,
    });

    if (writeOutputs) {
      writeEvaluationOutputs({
        summary,
        modelParams,
        heldOutRows,
        trainingSensitivity,
        heldOutSensitivity,
      });
    }

    return {
      summary,
      modelParams,
      trainingRows,
      heldOutRows,
      trainingSensitivity,
      heldOutSensitivity,
    };
  } finally {
    await source.close();
  }
};

const printSummary = (result) => {
  const { summary } = result;

  console.log("Risk model evaluation completed");
  console.log(`Training records: ${summary.split.trainingRecords}`);
  console.log(
    `Held-out claim scenarios evaluated: ${summary.dataset.evaluationScenarios}`
  );
  console.log(`Selected threshold: ${summary.decisionRule.selectedThreshold}`);
  console.log(`Accuracy: ${(summary.metrics.accuracy * 100).toFixed(2)}%`);
  console.log(`Precision: ${(summary.metrics.precision * 100).toFixed(2)}%`);
  console.log(`Recall: ${(summary.metrics.recall * 100).toFixed(2)}%`);
  console.log(`F1 score: ${(summary.metrics.f1Score * 100).toFixed(2)}%`);
  console.log(`AUC: ${summary.metrics.auc.toFixed(4)}`);
  console.log(`Average precision: ${summary.metrics.averagePrecision.toFixed(4)}`);
  console.log(`Results folder: ${RESULTS_DIR}`);
};

if (require.main === module) {
  runEvaluation({ useSynthetic: process.argv.includes("--synthetic") })
    .then(printSummary)
    .catch(async (error) => {
      console.error("Risk model evaluation failed:", error.message);
      await mongoose.connection.close();
      process.exit(1);
    });
}

module.exports = {
  applyThreshold,
  buildEvaluationScenarios,
  calculateMetrics,
  evaluateRecord,
  evaluateScenario,
  runEvaluation,
  scoreRecords,
  scoreScenarios,
  writeCsv,
};
