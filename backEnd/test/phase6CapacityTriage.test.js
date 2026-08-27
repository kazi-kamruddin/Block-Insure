const test = require("node:test");
const assert = require("node:assert/strict");
const {
  predictLogisticRegression,
  trainLogisticRegression,
} = require("../services/logisticRegressionService");
const {
  evaluateCapacityPolicy,
  runTriageEvaluation,
} = require("../services/triageEvaluationService");
const {
  DEFAULT_COST_SCENARIOS,
  routeRiskAssessment,
  verifyTriagePolicy,
} = require("../services/triagePolicyService");
const { generateSyntheticDataset } = require("../services/syntheticRegistryService");
const { toRows } = require("../services/phase5EvaluationService");
const triagePolicy = require("../triage-policy.json");

test("logistic regression learns a higher probability for the fraud-associated feature", () => {
  const rows = [
    { actualFraud: false, features: { signal: false } },
    { actualFraud: false, features: { signal: false } },
    { actualFraud: false, features: { signal: false } },
    { actualFraud: true, features: { signal: true } },
    { actualFraud: true, features: { signal: true } },
  ];
  const model = trainLogisticRegression({ rows, featureNames: ["signal"], iterations: 500 });
  assert.ok(
    predictLogisticRegression(model, { signal: true }).fraudProbability >
      predictLogisticRegression(model, { signal: false }).fraudProbability
  );
});

test("frozen triage policy is integrity checked and bound to a model identity", () => {
  assert.equal(verifyTriagePolicy(triagePolicy).valid, true);
  assert.match(triagePolicy.policyIdentityHash, /^0x[a-f0-9]{64}$/);
  const mutated = JSON.parse(JSON.stringify(triagePolicy));
  mutated.capacity.nominalReviewRate = 0.9;
  assert.equal(verifyTriagePolicy(mutated).valid, false);
});

test("probabilistic risk defers to review but cannot reject without a hard integrity failure", () => {
  const probabilistic = routeRiskAssessment({
    fraudProbability: 0.99,
    features: { clean_registry_match: false },
    policy: triagePolicy,
  });
  assert.equal(probabilistic.recommendation, "MANUAL_REVIEW_RECOMMENDED");
  const authoritative = routeRiskAssessment({
    fraudProbability: 0.01,
    features: { used_invoice: true },
    policy: triagePolicy,
  });
  assert.equal(authoritative.recommendation, "REJECT_ORACLE_VERIFICATION");
});

test("capacity-aware selection never exceeds the declared review budget", () => {
  const predictions = toRows(
    generateSyntheticDataset({ profile: "normal", seed: 771, size: 120 })
  ).map((row, index) => ({ ...row, fraudProbability: (index + 1) / 121 }));
  const result = evaluateCapacityPolicy(predictions, DEFAULT_COST_SCENARIOS[1], 0.2);
  assert.ok(result.manualReviews <= result.reviewSlots);
  assert.ok(result.manualReviewRate <= 0.2);
  assert.equal(result.actualFraud, predictions.filter((row) => row.actualFraud).length);
});

test("triage study reports model baselines, cost-capacity frontiers, and strict holdouts", () => {
  const result = runTriageEvaluation(
    generateSyntheticDataset({ profile: "normal", seed: 991, size: 240 }),
    { folds: 3, seed: 19, capacityRates: [0.1, 0.2] }
  );
  assert.equal(result.models.length, 7);
  assert.ok(result.recommendedOperatingPoint);
  assert.ok(result.models.every((model) => model.capacityFrontier.length === 6));
  assert.ok(result.models.every((model) => model.holdouts.temporal.records > 0));
  assert.ok(result.models.every((model) => model.holdouts.provider.heldOutProviders.length > 0));
  assert.equal(result.methodology.authorityBoundary.includes("hard integrity"), true);
});
