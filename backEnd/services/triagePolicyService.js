const crypto = require("node:crypto");
const { canonicalize } = require("./modelArtifactService");

const HARD_BLOCKING_FEATURES = Object.freeze([
  "registry_record_missing",
  "hospital_id_mismatch",
  "invoice_hash_mismatch",
  "invalid_record_status",
  "used_invoice",
  "cancelled_record",
  "license_blacklisted",
]);

const MANUAL_REVIEW_FEATURES = Object.freeze([
  "claim_exceeds_registry_bill",
  "bill_range_anomaly",
  "date_mismatch",
  "near_duplicate_advisory",
  "missing_or_noisy_record",
]);

const DEFAULT_COST_SCENARIOS = Object.freeze([
  { key: "balanced", missedFraudCost: 5, falseEscalationCost: 1, manualReviewCost: 0.25 },
  { key: "fraud_averse", missedFraudCost: 10, falseEscalationCost: 1, manualReviewCost: 0.25 },
  { key: "severe_missed_fraud", missedFraudCost: 20, falseEscalationCost: 1, manualReviewCost: 0.5 },
]);

const DEFAULT_CAPACITY_RATES = Object.freeze([0.05, 0.1, 0.2, 0.3, 0.5]);

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const hasHardBlockingFeatures = (features = {}) =>
  HARD_BLOCKING_FEATURES.some((name) => Boolean(features[name]));

const calculateEconomicReviewThreshold = (costs) =>
  (costs.manualReviewCost + costs.falseEscalationCost) /
  (costs.missedFraudCost + costs.falseEscalationCost);

const selectCapacityThreshold = (probabilities, capacityRate) => {
  if (!probabilities.length || capacityRate <= 0) return 1;
  if (capacityRate >= 1) return 0;
  const ordered = [...probabilities].sort((left, right) => right - left);
  const reviewSlots = Math.max(1, Math.floor(ordered.length * capacityRate));
  return ordered[Math.min(reviewSlots - 1, ordered.length - 1)];
};

const buildTriagePolicyPayload = ({
  modelArtifact,
  calibrationProbabilities,
  capacityRate = 0.2,
  costs = DEFAULT_COST_SCENARIOS[1],
  datasetManifestHash = null,
  sourceCommit = modelArtifact.gitCommit,
}) => {
  const economicThreshold = calculateEconomicReviewThreshold(costs);
  const capacityThreshold = selectCapacityThreshold(calibrationProbabilities, capacityRate);
  return {
    artifactSchemaVersion: 1,
    policyVersion: "capacity-cost-triage-v1.1.0",
    sourceCommit,
    modelIdentityHash: modelArtifact.modelIdentityHash,
    modelArtifactHash: modelArtifact.artifactHash,
    featureSchemaVersion: modelArtifact.featureSchemaVersion,
    datasetManifestHash,
    decisionAuthority: {
      probabilisticModelMayReject: false,
      hardIntegrityRulesRemainAuthoritative: true,
      oracleAndManualAdjudicationRemainSettlementAuthorities: true,
    },
    costs: { ...costs },
    capacity: {
      nominalReviewRate: capacityRate,
      definition: "maximum fraction of non-hard-blocked claims routed to manual review per planning window",
      enforcement: "offline-derived operating point; runtime reports policy state but does not claim a live queue guarantee",
    },
    routing: {
      hardBlockingFeatures: [...HARD_BLOCKING_FEATURES],
      manualReviewFeatures: [...MANUAL_REVIEW_FEATURES],
      economicReviewThreshold: economicThreshold,
      capacityReviewThreshold: capacityThreshold,
      manualReviewThreshold: Math.max(economicThreshold, capacityThreshold),
      fuzzyDuplicateAlwaysManual: true,
    },
    methodology: {
      thresholdSelection: "maximum of cost crossover and calibration-set capacity quantile",
      calibrationPartitionOnly: true,
      syntheticDataLimitation: true,
    },
  };
};

const artifactPayload = (artifact) => {
  const { artifactHash, policyIdentityHash, ...payload } = artifact;
  return payload;
};

const freezeTriagePolicy = (policy) => {
  const frozen = {
    ...artifactPayload(policy),
    artifactHash: sha256(canonicalize(artifactPayload(policy))),
  };
  frozen.policyIdentityHash = `0x${sha256(canonicalize({
    policyVersion: frozen.policyVersion,
    modelIdentityHash: frozen.modelIdentityHash,
    featureSchemaVersion: frozen.featureSchemaVersion,
    artifactHash: frozen.artifactHash,
    sourceCommit: frozen.sourceCommit,
  }))}`;
  return frozen;
};

const verifyTriagePolicy = (artifact) => {
  const expected = freezeTriagePolicy(artifact);
  const errors = [];
  if (artifact.artifactHash !== expected.artifactHash) {
    errors.push("artifactHash does not match canonical triage policy");
  }
  if (artifact.policyIdentityHash !== expected.policyIdentityHash) {
    errors.push("policyIdentityHash does not match the frozen triage policy identity");
  }
  return { valid: errors.length === 0, errors, expected };
};

const routeRiskAssessment = ({
  fraudProbability,
  features,
  hardBlockingComparison = false,
  fuzzyDuplicate = false,
  policy,
}) => {
  const hardFeature = hasHardBlockingFeatures(features);
  if (hardBlockingComparison || hardFeature) {
    return {
      recommendation: "REJECT_ORACLE_VERIFICATION",
      reason: hardBlockingComparison ? "HARD_COMPARISON_FAILURE" : "HARD_INTEGRITY_FEATURE",
      capacityConstrained: false,
    };
  }
  if (fuzzyDuplicate && policy.routing.fuzzyDuplicateAlwaysManual) {
    return {
      recommendation: "MANUAL_REVIEW_RECOMMENDED",
      reason: "FUZZY_DUPLICATE_ABSTENTION",
      capacityConstrained: false,
    };
  }
  if ((policy.routing.manualReviewFeatures || []).some((name) => Boolean(features[name]))) {
    return {
      recommendation: "MANUAL_REVIEW_RECOMMENDED",
      reason: "COMMITTED_ANOMALY_ABSTENTION",
      capacityConstrained: false,
    };
  }
  if (fraudProbability >= policy.routing.manualReviewThreshold) {
    return {
      recommendation: "MANUAL_REVIEW_RECOMMENDED",
      reason: "CAPACITY_COST_POLICY",
      capacityConstrained: policy.routing.capacityReviewThreshold >= policy.routing.economicReviewThreshold,
    };
  }
  return {
    recommendation: "AUTO_VERIFY_RECOMMENDED",
    reason: "BELOW_MANUAL_REVIEW_OPERATING_POINT",
    capacityConstrained: policy.routing.capacityReviewThreshold >= policy.routing.economicReviewThreshold,
  };
};

module.exports = {
  DEFAULT_CAPACITY_RATES,
  DEFAULT_COST_SCENARIOS,
  HARD_BLOCKING_FEATURES,
  MANUAL_REVIEW_FEATURES,
  buildTriagePolicyPayload,
  calculateEconomicReviewThreshold,
  freezeTriagePolicy,
  hasHardBlockingFeatures,
  routeRiskAssessment,
  selectCapacityThreshold,
  verifyTriagePolicy,
};
