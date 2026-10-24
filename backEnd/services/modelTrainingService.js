const {
  trainBernoulliNaiveBayes,
} = require("./bernoulliNaiveBayesService");
const {
  FEATURE_NAMES,
  FEATURE_SCHEMA_VERSION,
  extractObservableRecordFeatures,
} = require("./featureEngineeringService");
const {
  calculateTrainingDataHash,
  freezeModelArtifact,
} = require("./modelArtifactService");

const isFraudRecord = (record) =>
  record?.actualFraud ?? Boolean(record?.fraudLabel && record.fraudLabel !== "LEGITIMATE");

const FACTOR_PREDICATES = Object.fromEntries(
  FEATURE_NAMES.map((name) => [name, (record) => Boolean(extractObservableRecordFeatures(record)[name])])
);

const trainModelParams = (records, metadata = {}) => {
  const rows = records.map((record) => ({
    actualFraud: isFraudRecord(record),
    features: extractObservableRecordFeatures(record),
  }));
  const model = trainBernoulliNaiveBayes({
    rows,
    featureNames: FEATURE_NAMES,
    alpha: metadata.alpha || 1,
  });
  const artifact = {
    artifactSchemaVersion: 3,
    inferenceEngineVersion: "observable-runtime-v2",
    featureExtraction: "shared-proof-bound-observables-v1; reconstructed same-record claim unless paired context supplied",
    modelVersion: metadata.modelVersion || "bernoulli-fraud-v3",
    trainedAt: metadata.trainedAt || new Date().toISOString(),
    source: metadata.source || "Phase 5 synthetic registry",
    gitCommit: metadata.gitCommit || process.env.GIT_COMMIT || "WORKTREE",
    trainingDataHash: calculateTrainingDataHash(
      records.map((record, index) => ({ ...record, features: rows[index].features }))
    ),
    calibrationDataHash: metadata.calibrationDataHash || null,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    threshold: metadata.threshold ?? 0.5,
    calibration: metadata.calibration || {
      method: "none",
      version: "uncalibrated-v1",
      reason: "Runtime artifact remains uncalibrated until leakage-safe validation selects a calibrator",
    },
    trainingSet: {
      totalRecords: records.length,
      fraudRecords: model.classCounts.fraud,
      legitimateRecords: model.classCounts.legitimate,
      priorFraudProbability: model.classPrior.fraud,
      classDistribution: { ...model.classCounts },
      smoothing: `Laplace alpha=${model.alpha}`,
    },
    algorithm: model.algorithm,
    alpha: model.alpha,
    featureNames: model.featureNames,
    classCounts: model.classCounts,
    classPrior: model.classPrior,
    featureProbabilities: model.featureProbabilities,
  };
  return freezeModelArtifact(artifact);
};

module.exports = {
  FACTOR_PREDICATES,
  isFraudRecord,
  trainModelParams,
};
