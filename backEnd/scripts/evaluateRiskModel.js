require("dotenv").config();

const dns = require("dns");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const MockHospitalRecord = require("../models/MockHospitalRecord");
const { buildVerificationComparison } = require("../controllers/mockHospitalController");
const { buildRiskAssessment } = require("../services/riskScoringService");
const { trainModelParams } = require("../services/modelTrainingService");

dns.setDefaultResultOrder("ipv4first");

if (process.env.FORCE_PUBLIC_DNS === "true") {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
}

const RESULTS_DIR = path.join(__dirname, "..", "evaluation-results");
const EVALUATION_THRESHOLD = 50;

const formatDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

const round = (value, decimals = 4) => {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(decimals));
};

const isFraudRecord = (record) => {
  return record.fraudLabel !== "LEGITIMATE";
};

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

const calculateAuc = (rows) => {
  const positiveRows = rows.filter((row) => row.actualFraud);
  const negativeRows = rows.filter((row) => !row.actualFraud);

  if (positiveRows.length === 0 || negativeRows.length === 0) {
    return null;
  }

  let pairScore = 0;

  positiveRows.forEach((positive) => {
    negativeRows.forEach((negative) => {
      if (positive.riskScore > negative.riskScore) pairScore += 1;
      if (positive.riskScore === negative.riskScore) pairScore += 0.5;
    });
  });

  return pairScore / (positiveRows.length * negativeRows.length);
};

const calculateMetrics = (rows, split) => {
  const matrix = {
    truePositive: 0,
    trueNegative: 0,
    falsePositive: 0,
    falseNegative: 0,
  };
  const riskBuckets = {
    LOW: 0,
    MEDIUM: 0,
    HIGH: 0,
  };
  const labelBreakdown = {};
  let riskScoreTotal = 0;

  rows.forEach((row) => {
    if (row.actualFraud && row.predictedFraud) matrix.truePositive += 1;
    if (!row.actualFraud && !row.predictedFraud) matrix.trueNegative += 1;
    if (!row.actualFraud && row.predictedFraud) matrix.falsePositive += 1;
    if (row.actualFraud && !row.predictedFraud) matrix.falseNegative += 1;

    riskBuckets[row.riskBucket] += 1;
    riskScoreTotal += row.riskScore;

    if (!labelBreakdown[row.fraudLabel]) {
      labelBreakdown[row.fraudLabel] = createEmptyLabelStats();
    }

    labelBreakdown[row.fraudLabel].total += 1;
    labelBreakdown[row.fraudLabel].predictedFraud += row.predictedFraud ? 1 : 0;
    labelBreakdown[row.fraudLabel].avgRiskScoreTotal += row.riskScore;
  });

  const { truePositive, trueNegative, falsePositive, falseNegative } = matrix;
  const accuracy =
    rows.length > 0 ? (truePositive + trueNegative) / rows.length : 0;
  const precision =
    truePositive + falsePositive > 0
      ? truePositive / (truePositive + falsePositive)
      : 0;
  const recall =
    truePositive + falseNegative > 0
      ? truePositive / (truePositive + falseNegative)
      : 0;
  const specificity =
    trueNegative + falsePositive > 0
      ? trueNegative / (trueNegative + falsePositive)
      : 0;
  const f1Score =
    precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    generatedAt: new Date().toISOString(),
    dataset: {
      totalRecords: rows.length,
      legitimateRecords: rows.filter((row) => !row.actualFraud).length,
      fraudRecords: rows.filter((row) => row.actualFraud).length,
      fraudRate: round(
        rows.length > 0
          ? rows.filter((row) => row.actualFraud).length / rows.length
          : 0
      ),
    },
    split,
    decisionRule: {
      predictedFraud: `posterior fraud risk score >= ${EVALUATION_THRESHOLD}`,
      riskBucket: "LOW < 35, MEDIUM 35-69, HIGH >= 70",
    },
    confusionMatrix: matrix,
    metrics: {
      accuracy: round(accuracy),
      precision: round(precision),
      recall: round(recall),
      specificity: round(specificity),
      f1Score: round(f1Score),
      auc: round(calculateAuc(rows)),
      averageRiskScore: round(riskScoreTotal / Math.max(rows.length, 1), 2),
    },
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
  };
};

const evaluateRecord = async (record, trainingRecords, modelParams) => {
  const query = {
    hospitalId: record.hospitalId,
    invoiceHash: record.invoiceHash,
    claimAmountEth: record.billAmount,
    claimType: record.treatmentType,
    incidentDate: formatDate(record.admissionDate),
  };
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
  const actualFraud = isFraudRecord(record);
  const predictedFraud = riskAssessment.riskScore >= EVALUATION_THRESHOLD;

  return {
    hospitalId: record.hospitalId,
    invoiceNumber: record.invoiceNumber,
    treatmentType: record.treatmentType,
    fraudLabel: record.fraudLabel,
    actualFraud,
    predictedFraud,
    verified: !predictedFraud,
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

const runEvaluation = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing in .env");
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const records = await MockHospitalRecord.find()
    .sort({ hospitalId: 1, invoiceNumber: 1 })
    .lean();

  if (records.length === 0) {
    throw new Error("No synthetic registry records found. Run npm run seed:mock first.");
  }

  const trainingRecords = records.filter((_, index) => index % 5 !== 0);
  const testRecords = records.filter((_, index) => index % 5 === 0);
  const modelParams = trainModelParams(trainingRecords, {
    source: "Deterministic 80% evaluation training split",
  });
  const rows = [];

  for (const record of testRecords) {
    rows.push(await evaluateRecord(record, trainingRecords, modelParams));
  }

  const summary = calculateMetrics(rows, {
    method: "Deterministic 80/20 split after stable hospital/invoice sort",
    trainingRecords: trainingRecords.length,
    testRecords: testRecords.length,
    trainingPercent: round(trainingRecords.length / records.length),
    testPercent: round(testRecords.length / records.length),
    evaluationScope: "Metrics are calculated on the held-out test set only",
    modelVersion: modelParams.modelVersion,
  });

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
  writeCsv(path.join(RESULTS_DIR, "risk-model-records.csv"), rows);

  console.log("Risk model evaluation completed");
  console.log(`Training records: ${trainingRecords.length}`);
  console.log(`Held-out records evaluated: ${summary.dataset.totalRecords}`);
  console.log(`Accuracy: ${(summary.metrics.accuracy * 100).toFixed(2)}%`);
  console.log(`Precision: ${(summary.metrics.precision * 100).toFixed(2)}%`);
  console.log(`Recall: ${(summary.metrics.recall * 100).toFixed(2)}%`);
  console.log(`F1 score: ${(summary.metrics.f1Score * 100).toFixed(2)}%`);
  console.log(
    `AUC: ${
      summary.metrics.auc === null
        ? "Unavailable (held-out set needs both classes)"
        : summary.metrics.auc.toFixed(4)
    }`
  );
  console.log(`Results folder: ${RESULTS_DIR}`);

  await mongoose.connection.close();
};

if (require.main === module) {
  runEvaluation().catch(async (error) => {
    console.error("Risk model evaluation failed:", error.message);
    await mongoose.connection.close();
    process.exit(1);
  });
}

module.exports = {
  calculateAuc,
  calculateMetrics,
  evaluateRecord,
};
