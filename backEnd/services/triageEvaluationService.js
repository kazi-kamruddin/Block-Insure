const { calibrateProbability, fitPlattScaling } = require("./calibrationService");
const {
  predictBernoulliNaiveBayes,
  trainBernoulliNaiveBayes,
} = require("./bernoulliNaiveBayesService");
const {
  predictLogisticRegression,
  trainLogisticRegression,
} = require("./logisticRegressionService");
const {
  buildGroupedStratifiedFolds,
  buildProviderHoldout,
  splitCalibrationRows,
  summarizePredictions,
  toRows,
} = require("./phase5EvaluationService");
const { FEATURE_NAMES } = require("./featureEngineeringService");
const { createRandom } = require("./syntheticRegistryService");
const {
  DEFAULT_CAPACITY_RATES,
  DEFAULT_COST_SCENARIOS,
  calculateEconomicReviewThreshold,
  hasHardBlockingFeatures,
} = require("./triagePolicyService");

const MODEL_DEFINITIONS = Object.freeze([
  { key: "rule_only", label: "Rule-only ranking" },
  { key: "nb_uncalibrated", label: "Bernoulli NB, uncalibrated" },
  { key: "nb_calibrated", label: "Bernoulli NB, Platt calibrated" },
  { key: "logistic", label: "Logistic regression, Platt calibrated" },
  { key: "weighted_logistic", label: "Class-weighted logistic, Platt calibrated" },
  { key: "random_reference", label: "Random review reference" },
  { key: "perfect_reference", label: "Perfect-ranking upper reference" },
]);

const ruleOnlyProbability = (features) => {
  if (hasHardBlockingFeatures(features)) return 0.999;
  const activeRiskFeatures = FEATURE_NAMES.filter(
    (name) => name !== "clean_registry_match" && Boolean(features?.[name])
  ).length;
  return Math.min(0.95, activeRiskFeatures / 6);
};

const fitPredictor = (modelKey, fitRows, calibrationRows, seed) => {
  if (modelKey === "rule_only") {
    return (row) => ruleOnlyProbability(row.features);
  }
  if (modelKey === "random_reference") {
    const random = createRandom(`triage-random:${seed}`);
    const values = new Map();
    return (row) => {
      if (!values.has(row.id)) values.set(row.id, random());
      return values.get(row.id);
    };
  }
  if (modelKey === "perfect_reference") {
    return (row) => Number(row.actualFraud);
  }

  if (modelKey.startsWith("nb_")) {
    const model = trainBernoulliNaiveBayes({ rows: fitRows, featureNames: FEATURE_NAMES });
    if (modelKey === "nb_uncalibrated") {
      return (row) => predictBernoulliNaiveBayes(model, row.features).fraudProbability;
    }
    const calibrationRowsWithScores = calibrationRows.map((row) => ({
      ...row,
      fraudProbability: predictBernoulliNaiveBayes(model, row.features).fraudProbability,
    }));
    const calibration = fitPlattScaling(calibrationRowsWithScores);
    return (row) => calibrateProbability(
      predictBernoulliNaiveBayes(model, row.features).fraudProbability,
      calibration
    );
  }

  const model = trainLogisticRegression({
    rows: fitRows,
    featureNames: FEATURE_NAMES,
    classWeighted: modelKey === "weighted_logistic",
  });
  const calibrationRowsWithScores = calibrationRows.map((row) => ({
    ...row,
    fraudProbability: predictLogisticRegression(model, row.features).fraudProbability,
  }));
  const calibration = fitPlattScaling(calibrationRowsWithScores);
  return (row) => calibrateProbability(
    predictLogisticRegression(model, row.features).fraudProbability,
    calibration
  );
};

const scoreEvaluationPartition = ({ modelKey, trainRows, testRows, seed }) => {
  const { fitRows, calibrationRows } = splitCalibrationRows(trainRows);
  const predict = fitPredictor(modelKey, fitRows, calibrationRows, seed);
  return testRows.map((row) => ({ ...row, fraudProbability: predict(row) }));
};

const evaluateCapacityPolicy = (predictions, costs, capacityRate) => {
  const hardBlocked = predictions.filter((row) => hasHardBlockingFeatures(row.features));
  const eligible = predictions.filter((row) => !hasHardBlockingFeatures(row.features));
  const economicThreshold = calculateEconomicReviewThreshold(costs);
  const reviewSlots = Math.floor(eligible.length * capacityRate);
  const economicallyUseful = eligible
    .filter((row) => row.fraudProbability >= economicThreshold)
    .sort((left, right) =>
      right.fraudProbability - left.fraudProbability || String(left.id).localeCompare(String(right.id))
    );
  const reviewed = economicallyUseful.slice(0, reviewSlots);
  const reviewedIds = new Set(reviewed.map((row) => row.id));
  const autoVerified = eligible.filter((row) => !reviewedIds.has(row.id));
  const hardFraud = hardBlocked.filter((row) => row.actualFraud).length;
  const hardLegitimate = hardBlocked.length - hardFraud;
  const reviewedFraud = reviewed.filter((row) => row.actualFraud).length;
  const reviewedLegitimate = reviewed.length - reviewedFraud;
  const missedFraud = autoVerified.filter((row) => row.actualFraud).length;
  const actualFraud = predictions.filter((row) => row.actualFraud).length;
  const escalated = hardBlocked.length + reviewed.length;
  const caughtFraud = hardFraud + reviewedFraud;
  const expectedCost =
    missedFraud * costs.missedFraudCost +
    (hardLegitimate + reviewedLegitimate) * costs.falseEscalationCost +
    reviewed.length * costs.manualReviewCost;
  return {
    costScenario: costs.key,
    capacityRate,
    reviewSlots,
    manualReviews: reviewed.length,
    hardBlocked: hardBlocked.length,
    autoVerified: autoVerified.length,
    actualFraud,
    caughtFraud,
    missedFraud,
    legitimateEscalations: hardLegitimate + reviewedLegitimate,
    recallAtCapacity: actualFraud ? caughtFraud / actualFraud : 0,
    precisionAtCapacity: escalated ? caughtFraud / escalated : 0,
    manualReviewRate: predictions.length ? reviewed.length / predictions.length : 0,
    totalEscalationRate: predictions.length ? escalated / predictions.length : 0,
    expectedCost,
    expectedCostPerClaim: expectedCost / Math.max(predictions.length, 1),
    economicThreshold,
    selectedProbabilityThreshold: reviewed.length
      ? Math.min(...reviewed.map((row) => row.fraudProbability))
      : 1,
  };
};

const evaluateLegacyFixedPolicy = (predictions, costs) => {
  const hardBlocked = predictions.filter((row) => hasHardBlockingFeatures(row.features));
  const nonHard = predictions.filter((row) => !hasHardBlockingFeatures(row.features));
  const rejected = nonHard.filter((row) => row.fraudProbability >= 0.85);
  const reviewed = nonHard.filter(
    (row) => row.fraudProbability >= 0.5 && row.fraudProbability < 0.85
  );
  const escalated = [...hardBlocked, ...rejected, ...reviewed];
  const escalatedIds = new Set(escalated.map((row) => row.id));
  const missedFraud = predictions.filter(
    (row) => row.actualFraud && !escalatedIds.has(row.id)
  ).length;
  const caughtFraud = escalated.filter((row) => row.actualFraud).length;
  const legitimateEscalations = escalated.length - caughtFraud;
  const actualFraud = predictions.filter((row) => row.actualFraud).length;
  const expectedCost =
    missedFraud * costs.missedFraudCost +
    legitimateEscalations * costs.falseEscalationCost +
    reviewed.length * costs.manualReviewCost;
  return {
    policy: "legacy fixed 0.5 manual / 0.85 probabilistic rejection",
    actualFraud,
    caughtFraud,
    missedFraud,
    manualReviews: reviewed.length,
    probabilisticRejections: rejected.length,
    hardBlocked: hardBlocked.length,
    legitimateEscalations,
    recall: actualFraud ? caughtFraud / actualFraud : 0,
    precision: escalated.length ? caughtFraud / escalated.length : 0,
    expectedCost,
    expectedCostPerClaim: expectedCost / Math.max(predictions.length, 1),
  };
};

const generateGroupedPredictions = (rows, modelKey, { folds = 5, seed = 11 } = {}) =>
  buildGroupedStratifiedFolds(rows, { folds, seed }).flatMap((fold) =>
    scoreEvaluationPartition({
      modelKey,
      trainRows: fold.trainRows,
      testRows: fold.testRows,
      seed: `${seed}:${fold.index}:${modelKey}`,
    })
  );

const evaluateHoldouts = (rows, modelKey) => {
  const ordered = [...rows].sort((left, right) => left.occurredAt - right.occurredAt);
  const split = Math.floor(ordered.length * 0.8);
  const temporalPredictions = scoreEvaluationPartition({
    modelKey,
    trainRows: ordered.slice(0, split),
    testRows: ordered.slice(split),
    seed: `temporal:${modelKey}`,
  });
  const provider = buildProviderHoldout(rows);
  const providerPredictions = scoreEvaluationPartition({
    modelKey,
    trainRows: provider.trainRows,
    testRows: provider.testRows,
    seed: `provider:${modelKey}`,
  });
  const primaryCosts = DEFAULT_COST_SCENARIOS[1];
  return {
    temporal: {
      records: temporalPredictions.length,
      classification: summarizePredictions(temporalPredictions),
      operatingPoint: evaluateCapacityPolicy(temporalPredictions, primaryCosts, 0.2),
    },
    provider: {
      heldOutProviders: provider.heldOutProviders,
      records: providerPredictions.length,
      classification: summarizePredictions(providerPredictions),
      operatingPoint: evaluateCapacityPolicy(providerPredictions, primaryCosts, 0.2),
    },
  };
};

const runTriageEvaluation = (
  records,
  { folds = 5, seed = 11, capacityRates = DEFAULT_CAPACITY_RATES, costScenarios = DEFAULT_COST_SCENARIOS } = {}
) => {
  const rows = toRows(records);
  const models = MODEL_DEFINITIONS.map((definition) => {
    const predictions = generateGroupedPredictions(rows, definition.key, { folds, seed });
    const classification = summarizePredictions(predictions);
    const capacityFrontier = costScenarios.flatMap((costs) =>
      capacityRates.map((capacityRate) => evaluateCapacityPolicy(predictions, costs, capacityRate))
    );
    return {
      ...definition,
      classification,
      legacyPolicy: evaluateLegacyFixedPolicy(predictions, costScenarios[1]),
      capacityFrontier,
      holdouts: evaluateHoldouts(rows, definition.key),
      predictions,
    };
  });
  const primaryModel = models.find((model) => model.key === "nb_calibrated");
  const recommendedOperatingPoint = primaryModel.capacityFrontier.find(
    (point) => point.costScenario === "fraud_averse" && point.capacityRate === 0.2
  );
  return {
    schemaVersion: 1,
    researchQuestion: "Does calibrated cost- and capacity-aware routing improve fraud capture and expected operational cost over fixed thresholds?",
    methodology: {
      grouping: "connected claimant-provider grouped out-of-fold predictions",
      calibration: "Platt scaling fitted inside each training fold",
      authorityBoundary: "probabilistic models route review only; hard integrity rules remain authoritative",
      reviewSemantics: "manual review is treated as a correct adjudication in the simulation and is charged an explicit review cost",
      limitation: "costs, review capacity, and labels are scenario-based synthetic assumptions",
    },
    records: rows.length,
    costScenarios: costScenarios.map((costs) => ({ ...costs })),
    capacityRates: [...capacityRates],
    primaryModel: "nb_calibrated",
    recommendedOperatingPoint,
    models: models.map(({ predictions, ...model }) => model),
    chartData: {
      costCapacityFrontier: primaryModel.capacityFrontier,
      primaryPredictions: primaryModel.predictions.map((row) => ({
        id: row.id,
        actualFraud: row.actualFraud,
        fraudProbability: row.fraudProbability,
      })),
    },
  };
};

module.exports = {
  MODEL_DEFINITIONS,
  evaluateCapacityPolicy,
  evaluateLegacyFixedPolicy,
  fitPredictor,
  generateGroupedPredictions,
  ruleOnlyProbability,
  runTriageEvaluation,
  scoreEvaluationPartition,
};
