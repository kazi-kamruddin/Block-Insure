const { performance } = require("node:perf_hooks");
const {
  calculateClassificationMetrics,
  calculateCurves,
} = require("./evaluationMetricsService");
const {
  calibrateProbability,
  fitIsotonicCalibration,
  fitPlattScaling,
} = require("./calibrationService");
const {
  predictBernoulliNaiveBayes,
  trainBernoulliNaiveBayes,
} = require("./bernoulliNaiveBayesService");
const {
  FEATURE_NAMES,
  extractRecordFeatures,
} = require("./featureEngineeringService");
const { createRandom } = require("./syntheticRegistryService");

class UnionFind {
  constructor() { this.parent = new Map(); }
  find(value) {
    if (!this.parent.has(value)) this.parent.set(value, value);
    const parent = this.parent.get(value);
    if (parent !== value) this.parent.set(value, this.find(parent));
    return this.parent.get(value);
  }
  union(left, right) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parent.set(rightRoot, leftRoot);
  }
}

const toRows = (records) => records.map((record) => ({
  id: record.recordId || record.invoiceNumber,
  claimantId: record.claimantId || record.patientHash,
  providerId: record.providerId || record.hospitalId,
  occurredAt: new Date(record.occurredAt || record.admissionDate),
  actualFraud: record.actualFraud ?? record.fraudLabel !== "LEGITIMATE",
  features: record.features || extractRecordFeatures(record),
}));

const buildGroupedStratifiedFolds = (rows, { folds = 5, seed = 1 } = {}) => {
  const unionFind = new UnionFind();
  for (const row of rows) unionFind.union(`c:${row.claimantId}`, `p:${row.providerId}`);
  const components = new Map();
  for (const row of rows) {
    const root = unionFind.find(`c:${row.claimantId}`);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(row);
  }
  const random = createRandom(seed);
  const shuffled = [...components.values()]
    .map((items) => ({ items, random: random(), fraud: items.filter((item) => item.actualFraud).length }))
    .sort((left, right) => right.items.length - left.items.length || right.fraud - left.fraud || left.random - right.random);
  const assignments = Array.from({ length: folds }, () => []);
  const totals = Array.from({ length: folds }, () => ({ size: 0, fraud: 0 }));
  const targetSize = rows.length / folds;
  const targetFraud = rows.filter((row) => row.actualFraud).length / folds;
  for (const [componentIndex, component] of shuffled.entries()) {
    const destination = componentIndex < folds
      ? componentIndex
      : totals
      .map((total, index) => ({
        index,
        cost: ((total.size + component.items.length - targetSize) / Math.max(targetSize, 1)) ** 2 +
          ((total.fraud + component.fraud - targetFraud) / Math.max(targetFraud, 1)) ** 2,
      }))
      .sort((left, right) => left.cost - right.cost || left.index - right.index)[0].index;
    assignments[destination].push(...component.items);
    totals[destination].size += component.items.length;
    totals[destination].fraud += component.fraud;
  }
  return assignments.map((testRows, index) => ({
    index,
    testRows,
    trainRows: assignments.flatMap((items, itemIndex) => itemIndex === index ? [] : items),
  }));
};

const assertNoGroupLeakage = (fold) => {
  const testClaimants = new Set(fold.testRows.map((row) => row.claimantId));
  const testProviders = new Set(fold.testRows.map((row) => row.providerId));
  const claimantLeak = fold.trainRows.some((row) => testClaimants.has(row.claimantId));
  const providerLeak = fold.trainRows.some((row) => testProviders.has(row.providerId));
  return { valid: !claimantLeak && !providerLeak, claimantLeak, providerLeak };
};

const brierScore = (rows) => rows.reduce(
  (sum, row) => sum + (row.fraudProbability - Number(row.actualFraud)) ** 2,
  0
) / Math.max(rows.length, 1);

const expectedCalibrationError = (rows, bins = 10) => {
  let error = 0;
  for (let index = 0; index < bins; index += 1) {
    const lower = index / bins;
    const upper = (index + 1) / bins;
    const bucket = rows.filter((row) => row.fraudProbability >= lower && (index === bins - 1 ? row.fraudProbability <= upper : row.fraudProbability < upper));
    if (!bucket.length) continue;
    const confidence = bucket.reduce((sum, row) => sum + row.fraudProbability, 0) / bucket.length;
    const frequency = bucket.filter((row) => row.actualFraud).length / bucket.length;
    error += bucket.length / rows.length * Math.abs(confidence - frequency);
  }
  return error;
};

const summarizePredictions = (predictions, threshold = 0.5) => {
  const matrix = { truePositive: 0, trueNegative: 0, falsePositive: 0, falseNegative: 0 };
  for (const row of predictions) {
    const predicted = row.fraudProbability >= threshold;
    if (row.actualFraud && predicted) matrix.truePositive += 1;
    else if (row.actualFraud) matrix.falseNegative += 1;
    else if (predicted) matrix.falsePositive += 1;
    else matrix.trueNegative += 1;
  }
  const curves = calculateCurves(predictions.map((row) => ({
    actualFraud: row.actualFraud,
    fraudProbability: row.fraudProbability,
  })));
  return {
    confusionMatrix: matrix,
    ...calculateClassificationMetrics(matrix),
    rocAuc: curves.auc,
    prAuc: curves.averagePrecision,
    brierScore: brierScore(predictions),
    calibrationError: expectedCalibrationError(predictions),
  };
};

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
const confidenceInterval95 = (values) => {
  const average = mean(values);
  if (values.length < 2) return { mean: average, lower: average, upper: average };
  const standardError = Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1)) / Math.sqrt(values.length);
  return { mean: average, lower: average - 1.96 * standardError, upper: average + 1.96 * standardError };
};

const splitCalibrationRows = (trainingRows) => {
  const ordered = [...trainingRows].sort((left, right) => left.occurredAt - right.occurredAt);
  const split = Math.max(1, Math.floor(ordered.length * 0.8));
  return { fitRows: ordered.slice(0, split), calibrationRows: ordered.slice(split) };
};

const scoreRows = (model, rows) => rows.map((row) => ({
  ...row,
  fraudProbability: predictBernoulliNaiveBayes(model, row.features).fraudProbability,
}));

const evaluateFold = (fold, featureNames = FEATURE_NAMES) => {
  const leakage = assertNoGroupLeakage(fold);
  if (!leakage.valid) throw new Error(`Group leakage detected in fold ${fold.index}`);
  const { fitRows, calibrationRows } = splitCalibrationRows(fold.trainRows);
  const model = trainBernoulliNaiveBayes({ rows: fitRows, featureNames });
  const validationPredictions = scoreRows(model, calibrationRows);
  const uncalibrated = scoreRows(model, fold.testRows);
  const platt = fitPlattScaling(validationPredictions);
  const isotonic = validationPredictions.length >= 100
    ? fitIsotonicCalibration(validationPredictions)
    : null;
  const calibrationCandidates = [
    { method: "uncalibrated", calibration: { method: "none", version: "uncalibrated-v1" } },
    { method: "platt", calibration: platt },
    ...(isotonic ? [{ method: "isotonic", calibration: isotonic }] : []),
  ];
  const candidates = calibrationCandidates.map((candidate) => {
    const validationRows = validationPredictions.map((row) => ({
      ...row,
      fraudProbability: calibrateProbability(row.fraudProbability, candidate.calibration),
    }));
    const testRows = uncalibrated.map((row) => ({
      ...row,
      fraudProbability: calibrateProbability(row.fraudProbability, candidate.calibration),
    }));
    return {
      ...candidate,
      validationMetrics: summarizePredictions(validationRows),
      metrics: summarizePredictions(testRows),
    };
  });
  // Calibration method selection is validation-only; test metrics never choose a method.
  const selected = candidates.slice().sort(
    (left, right) => left.validationMetrics.brierScore - right.validationMetrics.brierScore
  )[0];
  return {
    fold: fold.index,
    leakage,
    candidates: candidates.map(({ method, calibration, validationMetrics, metrics }) => ({
      method,
      calibration,
      validationMetrics,
      metrics,
    })),
    selectedMethod: selected.method,
    selectedMetrics: selected.metrics,
  };
};

const runLeakageSafeEvaluation = (records, { seeds = [11, 29, 47], folds = 5 } = {}) => {
  const rows = toRows(records);
  const startedAt = performance.now();
  const evaluations = seeds.flatMap((seed) =>
    buildGroupedStratifiedFolds(rows, { folds, seed }).map((fold) => ({ seed, ...evaluateFold(fold) }))
  );
  const metricNames = ["accuracy", "precision", "recall", "f1Score", "rocAuc", "prAuc", "brierScore", "calibrationError"];
  const confidenceIntervals = Object.fromEntries(metricNames.map((name) => [
    name,
    confidenceInterval95(evaluations.map((evaluation) => evaluation.selectedMetrics[name])),
  ]));
  const ordered = [...rows].sort((left, right) => left.occurredAt - right.occurredAt);
  const temporalSplit = Math.floor(ordered.length * 0.8);
  const temporalTrain = ordered.slice(0, temporalSplit);
  const temporalTest = ordered.slice(temporalSplit);
  const temporalModel = trainBernoulliNaiveBayes({ rows: temporalTrain, featureNames: FEATURE_NAMES });
  const temporalMetrics = summarizePredictions(scoreRows(temporalModel, temporalTest));
  const fullModel = trainBernoulliNaiveBayes({ rows, featureNames: FEATURE_NAMES });
  const inferenceStart = performance.now();
  scoreRows(fullModel, rows);
  const inferenceMs = performance.now() - inferenceStart;
  const ablations = FEATURE_NAMES.map((removedFeature) => {
    const names = FEATURE_NAMES.filter((name) => name !== removedFeature);
    const model = trainBernoulliNaiveBayes({ rows, featureNames: names });
    return { removedFeature, metrics: summarizePredictions(scoreRows(model, rows)) };
  });
  return {
    schemaVersion: 3,
    methodology: {
      folds,
      seeds,
      grouping: "connected claimant-provider components",
      calibration: "validation partition inside each training fold only",
      temporalHoldout: "latest 20 percent by occurrence time",
    },
    records: rows.length,
    evaluations,
    confidenceIntervals,
    temporalHoldout: { trainingRecords: temporalTrain.length, testRecords: temporalTest.length, metrics: temporalMetrics },
    ablations,
    performance: {
      evaluationTimeMs: performance.now() - startedAt,
      totalInferenceTimeMs: inferenceMs,
      meanInferenceTimeMs: inferenceMs / Math.max(rows.length, 1),
    },
  };
};

module.exports = {
  assertNoGroupLeakage,
  brierScore,
  buildGroupedStratifiedFolds,
  confidenceInterval95,
  expectedCalibrationError,
  runLeakageSafeEvaluation,
  summarizePredictions,
  toRows,
};
