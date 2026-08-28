const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { performance } = require("node:perf_hooks");
const { calibrateProbability, fitPlattScaling } = require("../services/calibrationService");
const {
  predictBernoulliNaiveBayes,
  trainBernoulliNaiveBayes,
} = require("../services/bernoulliNaiveBayesService");
const {
  predictLogisticRegression,
  trainLogisticRegression,
} = require("../services/logisticRegressionService");
const {
  calculateThresholdSensitivity,
  selectBestThreshold,
} = require("../services/evaluationMetricsService");
const { extractRecordFeatures } = require("../services/featureEngineeringService");
const {
  atomicWriteFileSync,
  calculateReproducibilityHash,
} = require("../services/researchArtifactService");
const { freezeModelArtifact } = require("../services/modelArtifactService");
const { summarizePredictions } = require("../services/phase5EvaluationService");
const { loadHybridManifest } = require("../services/hybridDatasetIntegrityService");
const { createRandom } = require("../services/syntheticRegistryService");
const deployedModel = require("../model-params.json");
const triagePolicy = require("../triage-policy.json");

const DATASET_DIR = path.join(__dirname, "..", "datasets", "hybrid-v1");
const OUTPUT_PATH = path.join(__dirname, "..", "evaluation-results", "hybrid-v1-evaluation.json");
const PROVIDER_MODEL_PATH = path.join(
  __dirname,
  "..",
  "evaluation-results",
  "provider-risk-real-v1.0.0.json"
);
const PROVIDER_FEATURES = [
  "high_claim_volume",
  "high_unique_beneficiary_count",
  "high_mean_claim_amount",
  "high_max_claim_amount",
  "high_inpatient_ratio",
  "high_procedure_ratio",
  "high_repeat_claim_ratio",
  "high_mean_chronic_conditions",
  "high_beneficiary_activity_ratio",
];
const PROVIDER_FEATURE_GROUPS = {
  volume_and_activity: [
    "high_claim_volume",
    "high_unique_beneficiary_count",
    "high_repeat_claim_ratio",
    "high_beneficiary_activity_ratio",
  ],
  financial: ["high_mean_claim_amount", "high_max_claim_amount"],
  setting_and_clinical: [
    "high_inpatient_ratio",
    "high_procedure_ratio",
    "high_mean_chronic_conditions",
  ],
};
const PROVIDER_BOOTSTRAP = { repetitions: 1000, seed: 20260829 };

const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const percentile = (values, probability) => {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * probability))] || 0;
};
const ratio = (value, total) => value / Math.max(total, 1);
const round = (value, decimals = 6) => Number(Number(value).toFixed(decimals));

const forEachJsonLine = async (filePath, onRecord) => {
  const reader = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let count = 0;
  for await (const line of reader) {
    if (!line.trim()) continue;
    count += 1;
    await onRecord(JSON.parse(line), count);
  }
  return count;
};

const aggregateProviders = async (filePath) => {
  const providers = new Map();
  const claimCount = await forEachJsonLine(filePath, (record) => {
    const key = record.sourceProviderId || record.providerId;
    if (!providers.has(key)) {
      providers.set(key, {
        providerId: key,
        providerPotentialFraud: Boolean(record.providerPotentialFraud),
        claims: 0,
        beneficiaries: new Set(),
        totalAmount: 0,
        maxAmount: 0,
        inpatient: 0,
        procedures: 0,
        repeats: 0,
        chronicConditions: 0,
        beneficiaryActivity: 0,
      });
    }
    const provider = providers.get(key);
    const amount = Number(record.sourceClaimAmountUsd || 0);
    provider.claims += 1;
    provider.beneficiaries.add(record.sourceBeneId || record.claimantId);
    provider.totalAmount += amount;
    provider.maxAmount = Math.max(provider.maxAmount, amount);
    provider.inpatient += Number(record.claimSetting === "INPATIENT");
    provider.procedures += Number(Boolean(record.sourceProcedureCode));
    provider.repeats += Number(Number(record.previousClaimCount || 0) > 0);
    provider.chronicConditions += Number(record.chronicConditionCount || 0);
    provider.beneficiaryActivity += Number(Boolean(record.claimantVelocityAnomaly));
  });
  return {
    claimCount,
    providers: [...providers.values()].map((provider) => ({
      providerId: provider.providerId,
      actualFraud: provider.providerPotentialFraud,
      statistics: {
        claimCount: provider.claims,
        uniqueBeneficiaryCount: provider.beneficiaries.size,
        meanClaimAmount: provider.totalAmount / provider.claims,
        maxClaimAmount: provider.maxAmount,
        inpatientRatio: ratio(provider.inpatient, provider.claims),
        procedureRatio: ratio(provider.procedures, provider.claims),
        repeatClaimRatio: ratio(provider.repeats, provider.claims),
        meanChronicConditions: provider.chronicConditions / provider.claims,
        beneficiaryActivityRatio: ratio(provider.beneficiaryActivity, provider.claims),
      },
    })),
  };
};

const buildProviderThresholds = (rows) => Object.fromEntries(
  Object.keys(rows[0].statistics).map((name) => [name, percentile(rows.map((row) => row.statistics[name]), 0.75)])
);
const providerFeatures = (statistics, thresholds) => ({
  high_claim_volume: statistics.claimCount >= thresholds.claimCount,
  high_unique_beneficiary_count: statistics.uniqueBeneficiaryCount >= thresholds.uniqueBeneficiaryCount,
  high_mean_claim_amount: statistics.meanClaimAmount >= thresholds.meanClaimAmount,
  high_max_claim_amount: statistics.maxClaimAmount >= thresholds.maxClaimAmount,
  high_inpatient_ratio: statistics.inpatientRatio >= thresholds.inpatientRatio,
  high_procedure_ratio: statistics.procedureRatio >= thresholds.procedureRatio,
  high_repeat_claim_ratio: statistics.repeatClaimRatio >= thresholds.repeatClaimRatio,
  high_mean_chronic_conditions: statistics.meanChronicConditions >= thresholds.meanChronicConditions,
  high_beneficiary_activity_ratio: statistics.beneficiaryActivityRatio >= thresholds.beneficiaryActivityRatio,
});
const attachProviderFeatures = (rows, thresholds) => rows.map((row) => ({
  ...row,
  features: providerFeatures(row.statistics, thresholds),
}));
const scoreProviderRows = (model, rows, calibration) => rows.map((row) => ({
  ...row,
  fraudProbability: calibrateProbability(
    predictBernoulliNaiveBayes(model, row.features).fraudProbability,
    calibration
  ),
}));

const scoreProviderRowsWithPredictor = (model, rows, calibration, predict) => rows.map((row) => ({
  ...row,
  fraudProbability: calibrateProbability(
    predict(model, row.features).fraudProbability,
    calibration
  ),
}));

const fitProviderCandidate = ({
  trainRows,
  calibrationRows,
  testRows,
  featureNames,
  train,
  predict,
}) => {
  const model = train({ rows: trainRows, featureNames });
  const rawCalibration = scoreProviderRowsWithPredictor(
    model,
    calibrationRows,
    { method: "none" },
    predict
  );
  const calibration = {
    ...fitPlattScaling(rawCalibration),
    trainedOn: "provider-disjoint calibration partition",
    records: calibrationRows.length,
  };
  const calibrationPredictions = scoreProviderRowsWithPredictor(
    model,
    calibrationRows,
    calibration,
    predict
  );
  const selectedThreshold = selectBestThreshold(
    calculateThresholdSensitivity(calibrationPredictions, 0.01)
  );
  const testPredictions = scoreProviderRowsWithPredictor(
    model,
    testRows,
    calibration,
    predict
  );
  return {
    model,
    calibration,
    threshold: selectedThreshold.threshold,
    calibrationMetrics: summarizePredictions(calibrationPredictions, selectedThreshold.threshold),
    testMetrics: summarizePredictions(testPredictions, selectedThreshold.threshold),
    testPredictions,
  };
};

const ruleScoreProviderRows = (rows, featureNames = PROVIDER_FEATURES) => rows.map((row) => ({
  ...row,
  fraudProbability: featureNames.reduce(
    (sum, name) => sum + Number(Boolean(row.features[name])),
    0
  ) / featureNames.length,
}));

const percentileInterval = (values) => ({
  lower: round(percentile(values, 0.025)),
  upper: round(percentile(values, 0.975)),
});

const bootstrapProviderMetrics = (
  predictions,
  threshold,
  { repetitions = PROVIDER_BOOTSTRAP.repetitions, seed = PROVIDER_BOOTSTRAP.seed } = {}
) => {
  const random = createRandom(`provider-bootstrap:${seed}`);
  const metricNames = [
    "rocAuc",
    "prAuc",
    "precision",
    "recall",
    "f1Score",
    "matthewsCorrelationCoefficient",
  ];
  const samples = Object.fromEntries(metricNames.map((name) => [name, []]));
  for (let iteration = 0; iteration < repetitions; iteration += 1) {
    const resampled = Array.from(
      { length: predictions.length },
      () => predictions[Math.floor(random() * predictions.length)]
    );
    const metrics = summarizePredictions(resampled, threshold);
    for (const name of metricNames) samples[name].push(metrics[name]);
  }
  const point = summarizePredictions(predictions, threshold);
  return {
    method: "Provider-level seeded percentile bootstrap with replacement",
    unit: "provider",
    repetitions,
    seed,
    confidenceLevel: 0.95,
    metrics: Object.fromEntries(metricNames.map((name) => [name, {
      pointEstimate: point[name],
      ...percentileInterval(samples[name]),
    }])),
  };
};

const evaluateProviderBaselines = ({ trainRows, calibrationRows, testRows }) => {
  const prevalence = trainRows.filter((row) => row.actualFraud).length / trainRows.length;
  const majorityTestPredictions = testRows.map((row) => ({
    ...row,
    fraudProbability: prevalence,
  }));
  const ruleCalibration = ruleScoreProviderRows(calibrationRows);
  const ruleThreshold = selectBestThreshold(calculateThresholdSensitivity(ruleCalibration, 0.01));
  const ruleTest = ruleScoreProviderRows(testRows);
  const candidates = [
    {
      key: "majority_negative",
      label: "Majority-negative prevalence baseline",
      algorithm: "Constant training prevalence",
      threshold: 0.5,
      calibrationMetrics: summarizePredictions(
        calibrationRows.map((row) => ({ ...row, fraudProbability: prevalence })),
        0.5
      ),
      testMetrics: summarizePredictions(majorityTestPredictions, 0.5),
    },
    {
      key: "rule_score",
      label: "Unweighted high-risk-feature count",
      algorithm: "Rule score",
      threshold: ruleThreshold.threshold,
      calibrationMetrics: summarizePredictions(ruleCalibration, ruleThreshold.threshold),
      testMetrics: summarizePredictions(ruleTest, ruleThreshold.threshold),
    },
  ];
  for (const definition of [
    {
      key: "logistic_regression",
      label: "Logistic regression",
      classWeighted: false,
    },
    {
      key: "class_weighted_logistic",
      label: "Class-weighted logistic regression",
      classWeighted: true,
    },
  ]) {
    const candidate = fitProviderCandidate({
      trainRows,
      calibrationRows,
      testRows,
      featureNames: PROVIDER_FEATURES,
      train: (options) => trainLogisticRegression({
        ...options,
        classWeighted: definition.classWeighted,
      }),
      predict: predictLogisticRegression,
    });
    candidates.push({
      key: definition.key,
      label: definition.label,
      algorithm: candidate.model.algorithm,
      threshold: candidate.threshold,
      calibration: candidate.calibration,
      calibrationMetrics: candidate.calibrationMetrics,
      testMetrics: candidate.testMetrics,
    });
  }
  return candidates;
};

const evaluateProviderFeatureGroups = ({ trainRows, calibrationRows, testRows, primaryMetrics }) =>
  Object.entries(PROVIDER_FEATURE_GROUPS).map(([group, removedFeatures]) => {
    const featureNames = PROVIDER_FEATURES.filter((name) => !removedFeatures.includes(name));
    const candidate = fitProviderCandidate({
      trainRows,
      calibrationRows,
      testRows,
      featureNames,
      train: trainBernoulliNaiveBayes,
      predict: predictBernoulliNaiveBayes,
    });
    return {
      key: `without_${group}`,
      label: `Without ${group.replaceAll("_", " ")}`,
      removedFeatures,
      retainedFeatures: featureNames,
      threshold: candidate.threshold,
      testMetrics: candidate.testMetrics,
      deltaFromPrimary: {
        rocAuc: round(candidate.testMetrics.rocAuc - primaryMetrics.rocAuc),
        prAuc: round(candidate.testMetrics.prAuc - primaryMetrics.prAuc),
        f1Score: round(candidate.testMetrics.f1Score - primaryMetrics.f1Score),
      },
    };
  });

const evaluateProviderRisk = async (manifest) => {
  const [train, calibration, test] = await Promise.all([
    aggregateProviders(path.join(DATASET_DIR, manifest.outputFiles.train)),
    aggregateProviders(path.join(DATASET_DIR, manifest.outputFiles.calibration)),
    aggregateProviders(path.join(DATASET_DIR, manifest.outputFiles.testUntouched)),
  ]);
  const thresholds = buildProviderThresholds(train.providers);
  const trainRows = attachProviderFeatures(train.providers, thresholds);
  const calibrationRows = attachProviderFeatures(calibration.providers, thresholds);
  const testRows = attachProviderFeatures(test.providers, thresholds);
  const model = trainBernoulliNaiveBayes({ rows: trainRows, featureNames: PROVIDER_FEATURES });
  const rawCalibration = scoreProviderRows(model, calibrationRows, { method: "none" });
  const calibrationArtifact = {
    ...fitPlattScaling(rawCalibration),
    trainedOn: "provider-disjoint calibration partition",
    records: calibrationRows.length,
  };
  const calibratedRows = scoreProviderRows(model, calibrationRows, calibrationArtifact);
  const selectedThreshold = selectBestThreshold(calculateThresholdSensitivity(calibratedRows, 0.01));
  const testPredictions = scoreProviderRows(model, testRows, calibrationArtifact);
  const calibrationMetrics = summarizePredictions(calibratedRows, selectedThreshold.threshold);
  const testMetrics = summarizePredictions(testPredictions, selectedThreshold.threshold);
  const frozenModel = freezeModelArtifact({
    artifactSchemaVersion: 3,
    modelVersion: "provider-risk-real-v1.0.0",
    trainedAt: manifest.generatedAt,
    source: manifest.source.title,
    gitCommit: "WORKTREE",
    trainingDataHash: sha256(`${manifest.outputSha256.train}:${JSON.stringify(thresholds)}`),
    calibrationDataHash: manifest.outputSha256.calibration,
    featureSchemaVersion: "provider-risk-features-v1",
    threshold: selectedThreshold.threshold,
    calibration: calibrationArtifact,
    trainingSet: {
      totalRecords: trainRows.length,
      fraudRecords: trainRows.filter((row) => row.actualFraud).length,
      legitimateRecords: trainRows.filter((row) => !row.actualFraud).length,
      unit: "provider",
      sourceClaims: train.claimCount,
      smoothing: "Laplace alpha=1",
    },
    ...model,
    featureThresholds: thresholds,
    target: {
      field: "providerPotentialFraud",
      unit: "provider",
      interpretation: "Weak provider-level audit-prioritization label; not adjudicated claim fraud",
    },
  });
  return {
    modelArtifact: frozenModel,
    methodology: {
      unit: "provider",
      providerDisjoint: true,
      allClaimsAggregated: true,
      thresholdSelection: "Best calibration-partition F1 on 0.01 increments",
      comparatorPolicy: "Primary Bernoulli NB remains frozen; rule, prevalence, logistic, and class-weighted logistic comparators use the same provider-disjoint partitions and calibration-only threshold selection",
      uncertainty: "Seeded provider-level percentile bootstrap on the held-out test providers",
      featureAblation: "Leave-one-feature-group-out Bernoulli NB retraining with calibration-only threshold selection",
      labelBoundary: frozenModel.target.interpretation,
    },
    partitions: {
      train: { claims: train.claimCount, providers: trainRows.length },
      calibration: { claims: calibration.claimCount, providers: calibrationRows.length },
      test: { claims: test.claimCount, providers: testRows.length },
    },
    calibrationMetrics,
    testMetrics,
    confidenceIntervals: bootstrapProviderMetrics(testPredictions, selectedThreshold.threshold),
    baselines: evaluateProviderBaselines({ trainRows, calibrationRows, testRows }),
    featureGroupAblation: evaluateProviderFeatureGroups({
      trainRows,
      calibrationRows,
      testRows,
      primaryMetrics: testMetrics,
    }),
  };
};

const evaluateControlledAttacks = async (manifest) => {
  const manualThreshold = triagePolicy.routing.manualReviewThreshold;
  const score = (record) => {
    const features = extractRecordFeatures(record);
    const probability = calibrateProbability(
      predictBernoulliNaiveBayes(deployedModel, features).fraudProbability,
      deployedModel.calibration
    );
    const hardBlocked = triagePolicy.routing.hardBlockingFeatures.some((name) => features[name]);
    const anomalyRouted = (triagePolicy.routing.manualReviewFeatures || [])
      .some((name) => features[name]);
    const ruleDetected = hardBlocked || anomalyRouted;
    return {
      probability,
      routedProbability: ruleDetected ? 1 : probability,
      modelDetected: probability >= manualThreshold,
      ruleDetected,
      detected: ruleDetected || probability >= manualThreshold,
    };
  };
  const routingAblationPredictions = {
    model_only: { untouched: [], attacked: [] },
    integrity_rules_only: { untouched: [], attacked: [] },
    combined: { untouched: [], attacked: [] },
  };
  const addAblationPrediction = (partition, record, result, actualFraud) => {
    const common = {
      actualFraud,
      scenarioType: record.scenarioType || null,
    };
    routingAblationPredictions.model_only[partition].push({
      ...common,
      fraudProbability: result.probability,
    });
    routingAblationPredictions.integrity_rules_only[partition].push({
      ...common,
      fraudProbability: result.ruleDetected ? 1 : 0,
    });
    routingAblationPredictions.combined[partition].push({
      ...common,
      fraudProbability: result.routedProbability,
    });
  };
  const untouchedScores = new Map();
  const untouchedPredictions = [];
  await forEachJsonLine(path.join(DATASET_DIR, manifest.outputFiles.testUntouched), (record) => {
    const result = score(record);
    untouchedScores.set(record.sourceClaimId, result.probability);
    untouchedPredictions.push({ actualFraud: false, fraudProbability: result.routedProbability });
    addAblationPrediction("untouched", record, result, false);
  });
  const attackedPredictions = [];
  const scenarios = {};
  let pairedDeltaTotal = 0;
  let pairedDeltaCount = 0;
  await forEachJsonLine(path.join(DATASET_DIR, manifest.outputFiles.testAttacks), (record) => {
    const result = score(record);
    const actualFraud = Boolean(record.controlledAttackTruth);
    attackedPredictions.push({ actualFraud, fraudProbability: result.routedProbability });
    addAblationPrediction("attacked", record, result, actualFraud);
    if (actualFraud) {
      if (!scenarios[record.scenarioType]) scenarios[record.scenarioType] = { records: 0, detected: 0 };
      scenarios[record.scenarioType].records += 1;
      scenarios[record.scenarioType].detected += Number(result.detected);
      if (untouchedScores.has(record.sourceClaimId)) {
        pairedDeltaTotal += result.probability - untouchedScores.get(record.sourceClaimId);
        pairedDeltaCount += 1;
      }
    }
  });
  return {
    modelVersion: deployedModel.modelVersion,
    modelBoundary: "Synthetic-trained protocol irregularity model; evaluated separately from provider-risk-real-v1.0.0",
    ablationMethodology: "The same paired test records are scored by the probabilistic model alone, authoritative integrity rules alone, and their deployed union",
    routingThreshold: manualThreshold,
    metricInterpretation: "Positive means rejected or escalated for review; it does not mean convicted as fraud",
    untouchedMetrics: summarizePredictions(untouchedPredictions, manualThreshold),
    pairedAttackMetrics: summarizePredictions(attackedPredictions, manualThreshold),
    untouchedEscalationRate: untouchedPredictions.filter(
      (row) => row.fraudProbability >= manualThreshold
    ).length / Math.max(untouchedPredictions.length, 1),
    controlledAttackRoutingRecall: attackedPredictions.filter(
      (row) => row.actualFraud && row.fraudProbability >= manualThreshold
    ).length / Math.max(attackedPredictions.filter((row) => row.actualFraud).length, 1),
    meanInjectedProbabilityIncrease: pairedDeltaTotal / Math.max(pairedDeltaCount, 1),
    scenarioDetection: Object.fromEntries(
      Object.entries(scenarios).map(([name, value]) => [name, {
        ...value,
        recall: value.detected / value.records,
      }])
    ),
    routingAblation: Object.fromEntries(
      Object.entries(routingAblationPredictions).map(([key, partitions]) => {
        const attackedPositive = partitions.attacked.filter((row) => row.actualFraud);
        const scenarioNames = [...new Set(
          attackedPositive.map((row) => row.scenarioType).filter(Boolean)
        )].sort();
        return [key, {
          label: {
            model_only: "Probabilistic protocol model only",
            integrity_rules_only: "Authoritative integrity rules only",
            combined: "Combined model and integrity-rule routing",
          }[key],
          untouchedEscalationRate: partitions.untouched.filter(
            (row) => row.fraudProbability >= manualThreshold
          ).length / Math.max(partitions.untouched.length, 1),
          pairedAttackMetrics: summarizePredictions(partitions.attacked, manualThreshold),
          controlledAttackRoutingRecall: attackedPositive.filter(
            (row) => row.fraudProbability >= manualThreshold
          ).length / Math.max(attackedPositive.length, 1),
          scenarioRecall: Object.fromEntries(scenarioNames.map((scenarioName) => {
            const rows = attackedPositive.filter((row) => row.scenarioType === scenarioName);
            return [scenarioName, rows.filter(
              (row) => row.fraudProbability >= manualThreshold
            ).length / Math.max(rows.length, 1)];
          })),
        }];
      })
    ),
  };
};

const run = async ({ writeOutput = true } = {}) => {
  const startedAt = performance.now();
  const manifest = loadHybridManifest();
  const providerRisk = await evaluateProviderRisk(manifest);
  const controlledAttacks = await evaluateControlledAttacks(manifest);
  const result = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    datasetVersion: manifest.datasetVersion,
    sourceClaims: manifest.totalUniqueClaims,
    methodology: {
      hybridArchitecture: "Real public-secondary provider-risk evaluation plus controlled synthetic protocol-attack evaluation",
      providerHeldOut: true,
      beneficiaryOverlap: manifest.beneficiaryOverlap,
      noClaimFraudRelabeling: true,
    },
    providerRisk: {
      ...providerRisk,
      modelArtifact: {
        modelVersion: providerRisk.modelArtifact.modelVersion,
        modelIdentityHash: providerRisk.modelArtifact.modelIdentityHash,
        artifactHash: providerRisk.modelArtifact.artifactHash,
        threshold: providerRisk.modelArtifact.threshold,
        target: providerRisk.modelArtifact.target,
      },
    },
    controlledAttacks,
    performance: {
      evaluationTimeMs: performance.now() - startedAt,
      note: "Wall-clock measurement is descriptive and excluded from the reproducibility hash",
    },
  };
  result.reproducibilityHash = calculateReproducibilityHash(result);
  if (writeOutput) {
    atomicWriteFileSync(PROVIDER_MODEL_PATH, `${JSON.stringify(providerRisk.modelArtifact, null, 2)}\n`);
    atomicWriteFileSync(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`);
  }
  return result;
};

if (require.main === module) {
  run()
    .then((result) => {
      console.log(`Hybrid evaluation written to ${OUTPUT_PATH}`);
      console.log(`Provider-risk test F1: ${result.providerRisk.testMetrics.f1Score}`);
      console.log(`Controlled-attack recall: ${result.controlledAttacks.pairedAttackMetrics.recall}`);
    })
    .catch((error) => {
      console.error("Hybrid evaluation failed:", error);
      process.exitCode = 1;
    });
}

module.exports = {
  PROVIDER_FEATURES,
  PROVIDER_FEATURE_GROUPS,
  aggregateProviders,
  bootstrapProviderMetrics,
  buildProviderThresholds,
  evaluateControlledAttacks,
  evaluateProviderRisk,
  providerFeatures,
  run,
};
