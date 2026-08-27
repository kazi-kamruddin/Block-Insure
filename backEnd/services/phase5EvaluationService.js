const { performance } = require("node:perf_hooks");
const {
  calculateClassificationMetrics,
  calculateCurves,
  calculateThresholdSensitivity,
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
  constructor() {
    this.parent = new Map();
  }

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

const assignConnectedComponentIds = (rows) => {
  const unionFind = new UnionFind();
  for (const row of rows) unionFind.union(`c:${row.claimantId}`, `p:${row.providerId}`);
  return rows.map((row) => ({
    ...row,
    componentId: unionFind.find(`c:${row.claimantId}`),
  }));
};

const toRows = (records) => assignConnectedComponentIds(records.map((record) => ({
  id: record.recordId || record.invoiceNumber,
  claimantId: record.claimantId || record.patientHash,
  providerId: record.providerId || record.hospitalId,
  occurredAt: new Date(record.occurredAt || record.admissionDate),
  actualFraud: record.actualFraud ?? record.fraudLabel !== "LEGITIMATE",
  fraudLabel: record.fraudLabel || (record.actualFraud ? "FRAUD" : "LEGITIMATE"),
  features: record.features || extractRecordFeatures(record),
})));

const buildGroupedStratifiedFolds = (rows, { folds = 5, seed = 1 } = {}) => {
  const components = new Map();
  for (const row of assignConnectedComponentIds(rows)) {
    if (!components.has(row.componentId)) components.set(row.componentId, []);
    components.get(row.componentId).push(row);
  }
  const random = createRandom(seed);
  const shuffled = [...components.values()]
    .map((items) => ({
      items,
      random: random(),
      fraud: items.filter((item) => item.actualFraud).length,
    }))
    .sort((left, right) =>
      right.items.length - left.items.length ||
      right.fraud - left.fraud ||
      left.random - right.random
    );
  const effectiveFolds = Math.min(folds, shuffled.length);
  if (effectiveFolds < 2) {
    throw new Error("Grouped evaluation requires at least two claimant-provider components");
  }
  const assignments = Array.from({ length: effectiveFolds }, () => []);
  const totals = Array.from({ length: effectiveFolds }, () => ({ size: 0, fraud: 0 }));
  const targetSize = rows.length / effectiveFolds;
  const targetFraud = rows.filter((row) => row.actualFraud).length / effectiveFolds;
  for (const [componentIndex, component] of shuffled.entries()) {
    const destination = componentIndex < effectiveFolds
      ? componentIndex
      : totals
        .map((total, index) => ({
          index,
          cost:
            ((total.size + component.items.length - targetSize) / Math.max(targetSize, 1)) ** 2 +
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
    const bucket = rows.filter((row) =>
      row.fraudProbability >= lower &&
      (index === bins - 1 ? row.fraudProbability <= upper : row.fraudProbability < upper)
    );
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
const quantile = (values, probability) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower + 1] === undefined
    ? sorted[lower]
    : sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower]);
};

// Retained for compatibility. Phase 0 results use component-bootstrap intervals.
const confidenceInterval95 = (values) => {
  const average = mean(values);
  if (values.length < 2) return { mean: average, lower: average, upper: average };
  const standardError = Math.sqrt(
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1)
  ) / Math.sqrt(values.length);
  return {
    mean: average,
    lower: average - 1.96 * standardError,
    upper: average + 1.96 * standardError,
  };
};

const clusterBootstrapConfidenceIntervals = (
  predictions,
  { iterations = 250, seed = 202606 } = {}
) => {
  const groups = new Map();
  for (const row of predictions) {
    const key = row.componentId || `${row.claimantId}:${row.providerId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const clusters = [...groups.values()];
  if (!clusters.length) throw new Error("Cluster bootstrap requires predictions");
  const random = createRandom(`cluster-bootstrap:${seed}`);
  const metricNames = [
    "accuracy",
    "precision",
    "recall",
    "f1Score",
    "f2Score",
    "matthewsCorrelationCoefficient",
    "rocAuc",
    "prAuc",
    "brierScore",
    "calibrationError",
  ];
  const samples = Object.fromEntries(metricNames.map((name) => [name, []]));
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sampledRows = [];
    for (let draw = 0; draw < clusters.length; draw += 1) {
      sampledRows.push(...clusters[Math.floor(random() * clusters.length)]);
    }
    const metrics = summarizePredictions(sampledRows);
    for (const name of metricNames) samples[name].push(metrics[name]);
  }
  const point = summarizePredictions(predictions);
  return {
    method: "claimant-provider-component-percentile-bootstrap",
    iterations,
    clusters: clusters.length,
    seed,
    metrics: Object.fromEntries(metricNames.map((name) => [name, {
      mean: point[name],
      lower: quantile(samples[name], 0.025),
      upper: quantile(samples[name], 0.975),
    }])),
  };
};

const splitCalibrationRows = (trainingRows, fitFraction = 0.8) => {
  const ordered = [...trainingRows].sort((left, right) => left.occurredAt - right.occurredAt);
  const split = Math.min(ordered.length - 1, Math.max(1, Math.floor(ordered.length * fitFraction)));
  return { fitRows: ordered.slice(0, split), calibrationRows: ordered.slice(split) };
};

const scoreRows = (model, rows) => rows.map((row) => ({
  ...row,
  fraudProbability: predictBernoulliNaiveBayes(model, row.features).fraudProbability,
}));

const selectCalibration = (model, calibrationRows) => {
  const validationPredictions = scoreRows(model, calibrationRows);
  const calibrationCandidates = [
    { method: "uncalibrated", calibration: { method: "none", version: "uncalibrated-v1" } },
    { method: "platt", calibration: fitPlattScaling(validationPredictions) },
    ...(validationPredictions.length >= 100
      ? [{ method: "isotonic", calibration: fitIsotonicCalibration(validationPredictions) }]
      : []),
  ];
  const candidates = calibrationCandidates.map((candidate) => {
    const calibratedValidationRows = validationPredictions.map((row) => ({
      ...row,
      fraudProbability: calibrateProbability(row.fraudProbability, candidate.calibration),
    }));
    return {
      ...candidate,
      validationMetrics: summarizePredictions(calibratedValidationRows),
    };
  });
  const selected = candidates.sort(
    (left, right) => left.validationMetrics.brierScore - right.validationMetrics.brierScore
  )[0];
  return { ...selected, candidates };
};

const evaluateFold = (fold, featureNames = FEATURE_NAMES) => {
  const leakage = assertNoGroupLeakage(fold);
  if (!leakage.valid) throw new Error(`Group leakage detected in fold ${fold.index}`);
  const { fitRows, calibrationRows } = splitCalibrationRows(fold.trainRows);
  const model = trainBernoulliNaiveBayes({ rows: fitRows, featureNames });
  const selected = selectCalibration(model, calibrationRows);
  const selectedPredictions = scoreRows(model, fold.testRows).map((row) => ({
    ...row,
    fraudProbability: calibrateProbability(row.fraudProbability, selected.calibration),
  }));
  return {
    fold: fold.index,
    leakage,
    trainingRecords: fitRows.length,
    calibrationRecords: calibrationRows.length,
    selectedMethod: selected.method,
    selectedCalibration: selected.calibration,
    candidates: selected.candidates.map(({ method, calibration, validationMetrics }) => ({
      method,
      calibration,
      validationMetrics,
    })),
    validationMetrics: selected.validationMetrics,
    selectedMetrics: summarizePredictions(selectedPredictions),
    selectedPredictions,
  };
};

const evaluateTemporalHoldout = (rows, featureNames = FEATURE_NAMES) => {
  const ordered = [...rows].sort((left, right) => left.occurredAt - right.occurredAt);
  const temporalSplit = Math.floor(ordered.length * 0.8);
  const developmentRows = ordered.slice(0, temporalSplit);
  const testRows = ordered.slice(temporalSplit);
  const { fitRows, calibrationRows } = splitCalibrationRows(developmentRows);
  const model = trainBernoulliNaiveBayes({ rows: fitRows, featureNames });
  const selected = selectCalibration(model, calibrationRows);
  const predictions = scoreRows(model, testRows).map((row) => ({
    ...row,
    fraudProbability: calibrateProbability(row.fraudProbability, selected.calibration),
  }));
  return {
    trainingRecords: fitRows.length,
    calibrationRecords: calibrationRows.length,
    testRecords: testRows.length,
    selectedMethod: selected.method,
    selectedCalibration: selected.calibration,
    metrics: summarizePredictions(predictions),
  };
};

const buildProviderHoldout = (rows, { fraction = 0.2, seed = 202607 } = {}) => {
  const random = createRandom(`provider-holdout:${seed}`);
  const providers = [...new Set(rows.map((row) => row.providerId))]
    .map((providerId) => ({ providerId, random: random() }))
    .sort((left, right) => left.random - right.random || left.providerId.localeCompare(right.providerId));
  const count = Math.max(1, Math.floor(providers.length * fraction));
  const heldOutProviders = new Set(providers.slice(0, count).map((item) => item.providerId));
  const testRows = rows.filter((row) => heldOutProviders.has(row.providerId));
  const testClaimants = new Set(testRows.map((row) => row.claimantId));
  const trainRows = rows.filter(
    (row) => !heldOutProviders.has(row.providerId) && !testClaimants.has(row.claimantId)
  );
  return { trainRows, testRows, heldOutProviders: [...heldOutProviders].sort() };
};

const evaluateProviderHoldout = (rows, featureNames = FEATURE_NAMES) => {
  const holdout = buildProviderHoldout(rows);
  const { fitRows, calibrationRows } = splitCalibrationRows(holdout.trainRows);
  const model = trainBernoulliNaiveBayes({ rows: fitRows, featureNames });
  const selected = selectCalibration(model, calibrationRows);
  const predictions = scoreRows(model, holdout.testRows).map((row) => ({
    ...row,
    fraudProbability: calibrateProbability(row.fraudProbability, selected.calibration),
  }));
  return {
    trainingRecords: fitRows.length,
    calibrationRecords: calibrationRows.length,
    testRecords: holdout.testRows.length,
    heldOutProviders: holdout.heldOutProviders,
    selectedMethod: selected.method,
    metrics: summarizePredictions(predictions),
  };
};

const evaluateGroupedAblations = (rows, { folds = 5, seed = 11 } = {}) => {
  const groupedFolds = buildGroupedStratifiedFolds(rows, { folds, seed });
  return FEATURE_NAMES.map((removedFeature) => {
    const names = FEATURE_NAMES.filter((name) => name !== removedFeature);
    const predictions = groupedFolds.flatMap((fold) => evaluateFold(fold, names).selectedPredictions);
    return {
      removedFeature,
      method: "grouped out-of-fold evaluation",
      metrics: summarizePredictions(predictions),
    };
  });
};

const runLeakageSafeEvaluation = (
  records,
  { seeds = [11, 29, 47], folds = 5, bootstrapIterations = 250 } = {}
) => {
  const rows = toRows(records);
  const startedAt = performance.now();
  const detailedEvaluations = seeds.flatMap((seed) =>
    buildGroupedStratifiedFolds(rows, { folds, seed }).map((fold) => ({
      seed,
      ...evaluateFold(fold),
    }))
  );
  const primaryPredictions = detailedEvaluations
    .filter((evaluation) => evaluation.seed === seeds[0])
    .flatMap((evaluation) => evaluation.selectedPredictions);
  const bootstrap = clusterBootstrapConfidenceIntervals(primaryPredictions, {
    iterations: bootstrapIterations,
    seed: seeds[0],
  });
  const evaluations = detailedEvaluations.map(({ selectedPredictions, ...evaluation }) => evaluation);
  const temporalHoldout = evaluateTemporalHoldout(rows);
  const providerHoldout = evaluateProviderHoldout(rows);
  const fullModel = trainBernoulliNaiveBayes({ rows, featureNames: FEATURE_NAMES });
  const inferenceStart = performance.now();
  scoreRows(fullModel, rows);
  const inferenceMs = performance.now() - inferenceStart;
  const curves = calculateCurves(primaryPredictions);
  const thresholdSensitivity = calculateThresholdSensitivity(primaryPredictions).map((point) => ({
    ...point,
    thresholdPercent: point.threshold * 100,
  }));
  return {
    schemaVersion: 4,
    methodology: {
      folds,
      seeds,
      grouping: "connected claimant-provider components",
      calibration: "calibrator selected on the chronological calibration partition inside training only",
      confidenceIntervals: bootstrap.method,
      temporalHoldout: "earliest 64 percent fit, next 16 percent calibration, latest 20 percent test",
      providerHoldout: "20 percent of providers held out; overlapping claimants removed from training",
      ablations: "single-seed grouped out-of-fold evaluation; never trained and tested on identical rows",
    },
    records: rows.length,
    evaluations,
    confidenceIntervals: bootstrap.metrics,
    confidenceIntervalDetails: {
      method: bootstrap.method,
      iterations: bootstrap.iterations,
      clusters: bootstrap.clusters,
      seed: bootstrap.seed,
    },
    temporalHoldout,
    providerHoldout,
    ablations: evaluateGroupedAblations(rows, { folds, seed: seeds[0] }),
    chartData: {
      predictions: primaryPredictions.map((row) => ({
        id: row.id,
        actualFraud: row.actualFraud,
        fraudLabel: row.fraudLabel,
        fraudProbability: row.fraudProbability,
        fraudProbabilityPercent: row.fraudProbability * 100,
      })),
      confusionMatrix: summarizePredictions(primaryPredictions).confusionMatrix,
      curves,
      thresholdSensitivity,
    },
    performance: {
      evaluationTimeMs: performance.now() - startedAt,
      totalInferenceTimeMs: inferenceMs,
      meanInferenceTimeMs: inferenceMs / Math.max(rows.length, 1),
      note: "Wall-clock values are descriptive and excluded from reproducibility hashes",
    },
  };
};

module.exports = {
  assertNoGroupLeakage,
  assignConnectedComponentIds,
  brierScore,
  buildGroupedStratifiedFolds,
  buildProviderHoldout,
  clusterBootstrapConfidenceIntervals,
  confidenceInterval95,
  evaluateFold,
  evaluateProviderHoldout,
  evaluateTemporalHoldout,
  expectedCalibrationError,
  runLeakageSafeEvaluation,
  scoreRows,
  selectCalibration,
  splitCalibrationRows,
  summarizePredictions,
  toRows,
};
