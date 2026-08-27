const MockHospitalRecord = require("../models/MockHospitalRecord");
const loadedModelArtifact = require("../model-params.json");
const { calibrateProbability } = require("./calibrationService");
const { predictBernoulliNaiveBayes } = require("./bernoulliNaiveBayesService");
const { extractRuntimeFeatures } = require("./featureEngineeringService");
const { verifyModelArtifact } = require("./modelArtifactService");

const calculateStats = (values) => {
  const cleanValues = values.filter(Number.isFinite);
  if (!cleanValues.length) return { sampleSize: 0, mean: null, stdDev: null, min: null, max: null };
  const mean = cleanValues.reduce((sum, value) => sum + value, 0) / cleanValues.length;
  const variance = cleanValues.length > 1
    ? cleanValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (cleanValues.length - 1)
    : 0;
  return { sampleSize: cleanValues.length, mean, stdDev: Math.sqrt(variance), min: Math.min(...cleanValues), max: Math.max(...cleanValues) };
};

const getFraudLevel = (probability) => {
  if (probability >= 0.7) return "HIGH";
  if (probability >= 0.35) return "MEDIUM";
  return "LOW";
};

const buildRiskAssessment = async ({
  record,
  comparison,
  duplicateIntelligence = null,
  records: suppliedRecords,
  modelParams = loadedModelArtifact,
}) => {
  const integrity = verifyModelArtifact(modelParams);
  if (!integrity.valid) {
    throw new Error(`Fraud model artifact integrity failure: ${integrity.errors.join("; ")}`);
  }
  const records = suppliedRecords || await MockHospitalRecord.find().lean();
  const features = extractRuntimeFeatures({ record, comparison, duplicateIntelligence });
  const raw = predictBernoulliNaiveBayes(modelParams, features);
  const fraudProbability = calibrateProbability(raw.fraudProbability, modelParams.calibration);
  const fraudProbabilityPercent = Math.round(fraudProbability * 100);
  const fraudLevel = getFraudLevel(fraudProbability);
  const hardBlockingComparison = Number(comparison?.blockingFailureCount || 0) > 0;
  const fuzzyOnly = Boolean(duplicateIntelligence?.requiresManualReview) && !hardBlockingComparison;
  const recommendation = hardBlockingComparison || (!fuzzyOnly && fraudProbability >= 0.85)
    ? "REJECT_ORACLE_VERIFICATION"
    : fuzzyOnly || fraudProbability >= Number(modelParams.threshold)
      ? "MANUAL_REVIEW_RECOMMENDED"
      : "AUTO_VERIFY_RECOMMENDED";
  const evidence = raw.contributions.map((contribution) => ({
    key: contribution.feature,
    label: contribution.feature.replaceAll("_", " "),
    active: contribution.present,
    likelihoodGivenFraud: contribution.probabilityGivenFraud,
    likelihoodGivenLegitimate: contribution.probabilityGivenLegitimate,
    logLikelihoodRatio: contribution.logLikelihoodRatio,
    stateUsed: contribution.present ? "present" : "absent",
  }));

  return {
    modelVersion: modelParams.modelVersion,
    modelIdentityHash: modelParams.modelIdentityHash,
    artifactHash: modelParams.artifactHash,
    trainingDataHash: modelParams.trainingDataHash,
    featureSchemaVersion: modelParams.featureSchemaVersion,
    calibrationVersion: modelParams.calibration.version,
    method: "True Bernoulli Naive Bayes with Laplace smoothing and present/absent likelihoods",
    fraudProbability,
    fraudProbabilityPercent,
    fraudLevel,
    // Retained as the response risk category consumed by the oracle metadata API.
    riskLevel: fraudLevel,
    recommendation,
    threshold: modelParams.threshold,
    features,
    evidence,
    activeEvidence: evidence.filter((item) => item.active),
    riskDrivers: evidence.slice().sort((left, right) => Math.abs(right.logLikelihoodRatio) - Math.abs(left.logLikelihoodRatio)).slice(0, 5),
    dataset: {
      totalRecords: modelParams.trainingSet.totalRecords,
      fraudRecords: modelParams.trainingSet.fraudRecords,
      legitimateRecords: modelParams.trainingSet.legitimateRecords,
      runtimeRegistryRecords: records.length,
      smoothing: modelParams.trainingSet.smoothing,
    },
    duplicateIntelligence,
  };
};

module.exports = {
  buildRiskAssessment,
  calculateStats,
};
