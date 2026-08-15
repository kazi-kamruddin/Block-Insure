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
const { runLeakageSafeEvaluation } = require("../services/phase5EvaluationService");
const { generateSyntheticDataset } = require("../services/syntheticRegistryService");

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
    { actualFraud: true, fraudProbability: 0.9, claimAmountEth: 10 },
    { actualFraud: true, fraudProbability: 0.8, claimAmountEth: 9 },
    { actualFraud: false, fraudProbability: 0.2, claimAmountEth: 2 },
    { actualFraud: false, fraudProbability: 0.1, claimAmountEth: 1 },
  ];
  const curves = calculateCurves(rows);
  assert.strictEqual(curves.auc, 1);
  assert.strictEqual(curves.averagePrecision, 1);
  assert.strictEqual(curves.precisionRecall[0].precision, 1);

  const sensitivity = calculateThresholdSensitivity(rows);
  const selected = selectBestThreshold(sensitivity);
  assert.strictEqual(selected.f1Score, 1);
  assert.ok(selected.threshold <= 0.8 && selected.threshold > 0.2);

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

  const evaluation = runLeakageSafeEvaluation(
    generateSyntheticDataset({ size: 300, seed: 17 }),
    { seeds: [11], folds: 5 }
  );
  assert.strictEqual(evaluation.evaluations.length, 5);
  assert.ok(evaluation.confidenceIntervals.rocAuc.mean >= 0);
  assert.ok(evaluation.temporalHoldout.testRecords > 0);

  console.log("Section 3 analytics tests passed");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
