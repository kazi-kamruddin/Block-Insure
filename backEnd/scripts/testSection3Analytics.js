const assert = require("assert");

const { calculateStats } = require("../services/riskScoringService");
const {
  calculateBaselines,
  calculateCurves,
  calculateThresholdSensitivity,
  selectBestThreshold,
} = require("../services/evaluationMetricsService");
const {
  analyzeFinalizations,
  calculatePearsonCorrelation,
} = require("./analyzeAuditorReputation");
const { getPercentile, summarizeDurations } = require("./loadTestClaims");
const { runEvaluation } = require("./evaluateRiskModel");
const { buildSyntheticRecords } = require("./seedMockData");

const approximatelyEqual = (actual, expected, tolerance = 0.000001) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`
  );
};

const run = async () => {
  const sampleStats = calculateStats([1, 2, 3]);
  assert.strictEqual(sampleStats.sampleSize, 3);
  assert.strictEqual(sampleStats.mean, 2);
  assert.strictEqual(sampleStats.stdDev, 1);

  const rows = [
    { actualFraud: true, riskScore: 90, claimAmountEth: 10 },
    { actualFraud: true, riskScore: 80, claimAmountEth: 9 },
    { actualFraud: false, riskScore: 20, claimAmountEth: 2 },
    { actualFraud: false, riskScore: 10, claimAmountEth: 1 },
  ];
  const curves = calculateCurves(rows);
  assert.strictEqual(curves.auc, 1);
  assert.strictEqual(curves.averagePrecision, 1);
  assert.strictEqual(curves.precisionRecall[0].precision, 1);

  const sensitivity = calculateThresholdSensitivity(rows);
  const selected = selectBestThreshold(sensitivity);
  assert.strictEqual(selected.f1Score, 1);
  assert.ok(selected.threshold <= 80 && selected.threshold > 20);

  const baselines = calculateBaselines(rows, 5);
  assert.strictEqual(baselines[0].metrics.recall, 1);
  assert.strictEqual(baselines[0].metrics.precision, 0.5);
  assert.strictEqual(baselines[1].metrics.f1Score, 1);

  assert.strictEqual(getPercentile([1, 2, 3, 4, 5], 95), 5);
  assert.deepStrictEqual(summarizeDurations([10, 20, 30]), {
    averageMs: 20,
    p95Ms: 30,
    minMs: 10,
    maxMs: 30,
  });

  approximatelyEqual(
    calculatePearsonCorrelation([
      { x: 40, y: 0 },
      { x: 90, y: 1 },
    ]),
    1
  );

  const auditorAnalysis = await analyzeFinalizations(
    [
      {
        voters: [
          { auditorAddress: "0xaaa", votedWithConsensus: true },
          { auditorAddress: "0xbbb", votedWithConsensus: false },
        ],
      },
      {
        voters: [
          { auditorAddress: "0xaaa", votedWithConsensus: true },
          { auditorAddress: "0xbbb", votedWithConsensus: false },
        ],
      },
    ],
    async (wallet) => (wallet === "0xaaa" ? 90 : 40)
  );
  assert.strictEqual(auditorAnalysis.auditorsAnalyzed, 2);
  assert.strictEqual(auditorAnalysis.pearsonCorrelation, 1);

  const evaluation = await runEvaluation({
    useSynthetic: true,
    writeOutputs: false,
  });
  const syntheticRecordCount = buildSyntheticRecords().length;
  const expectedTrainingRecords = Math.floor(syntheticRecordCount * 0.8);
  const expectedHeldOutRecords = syntheticRecordCount - expectedTrainingRecords;

  assert.strictEqual(
    evaluation.summary.split.trainingRecords,
    expectedTrainingRecords
  );
  assert.strictEqual(evaluation.summary.dataset.totalRecords, expectedHeldOutRecords);
  assert.ok(evaluation.summary.metrics.auc >= 0 && evaluation.summary.metrics.auc <= 1);
  assert.ok(
    evaluation.summary.metrics.averagePrecision >= 0 &&
      evaluation.summary.metrics.averagePrecision <= 1
  );
  assert.strictEqual(evaluation.summary.baselines.length, 2);
  assert.strictEqual(evaluation.summary.thresholdAnalysis.heldOutSensitivity.length, 21);
  assert.strictEqual(
    evaluation.summary.thresholdAnalysis.heldOutSensitivity[0].threshold,
    100
  );
  assert.strictEqual(
    evaluation.summary.thresholdAnalysis.heldOutSensitivity.at(-1).threshold,
    0
  );

  console.log("Section 3 analytics tests passed");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
