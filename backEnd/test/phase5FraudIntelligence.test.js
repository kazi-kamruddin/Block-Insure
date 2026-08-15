const test = require("node:test");
const assert = require("node:assert/strict");
const { MultinomialNB } = require("ml-naivebayes");
const {
  predictBernoulliNaiveBayes,
  trainBernoulliNaiveBayes,
} = require("../services/bernoulliNaiveBayesService");
const {
  FEATURE_NAMES,
  extractRecordFeatures,
} = require("../services/featureEngineeringService");
const {
  assertNoGroupLeakage,
  buildGroupedStratifiedFolds,
  runLeakageSafeEvaluation,
  toRows,
} = require("../services/phase5EvaluationService");
const {
  generateAllSyntheticDatasets,
  generateSyntheticDataset,
} = require("../services/syntheticRegistryService");
const {
  analyzeDuplicateCandidate,
} = require("../services/duplicateIntelligenceService");
const {
  verifyModelArtifact,
} = require("../services/modelArtifactService");
const modelArtifact = require("../model-params.json");
const managerArtifact = require("../abi/InsuranceManager.json");

test("contract ABI names structural confidence separately from fraud probability", () => {
  const getClaim = managerArtifact.abi.find((entry) => entry.type === "function" && entry.name === "getClaim");
  const componentNames = getClaim.outputs[0].components.map((component) => component.name);
  assert.ok(componentNames.includes("verificationConfidence"));
  assert.equal(componentNames.includes("riskScore"), false);
});

test("Bernoulli model uses both present and absent feature probabilities", () => {
  const rows = [
    { actualFraud: false, features: { signal: false } },
    { actualFraud: false, features: { signal: false } },
    { actualFraud: true, features: { signal: true } },
    { actualFraud: true, features: { signal: true } },
  ];
  const model = trainBernoulliNaiveBayes({ rows, featureNames: ["signal"] });
  const present = predictBernoulliNaiveBayes(model, { signal: true });
  const absent = predictBernoulliNaiveBayes(model, { signal: false });
  assert.ok(present.fraudProbability > 0.5);
  assert.ok(absent.fraudProbability < 0.5);
  assert.equal(model.featureProbabilities.signal.fraud.absent, 0.25);
});

test("Bernoulli classifications match the ml-naivebayes reference on expanded binary features", () => {
  const training = [
    [0, 0], [0, 1], [0, 0], [1, 0],
    [1, 1], [1, 0], [1, 1], [0, 1],
  ];
  const labels = [0, 0, 0, 0, 1, 1, 1, 1];
  const expand = ([left, right]) => [left, 1 - left, right, 1 - right];
  const reference = new MultinomialNB();
  reference.train(training.map(expand), labels);
  const rows = training.map((values, index) => ({
    actualFraud: labels[index] === 1,
    features: { left: Boolean(values[0]), right: Boolean(values[1]) },
  }));
  const model = trainBernoulliNaiveBayes({ rows, featureNames: ["left", "right"] });
  const cases = [[0, 0], [0, 1], [1, 0], [1, 1]];
  const expected = reference.predict(cases.map(expand));
  const actual = cases.map(([left, right]) => Number(
    predictBernoulliNaiveBayes(model, { left: Boolean(left), right: Boolean(right) }).predictedFraud
  ));
  assert.deepEqual(actual, expected);
});

test("frozen runtime model hashes match and parameter mutation is detected", () => {
  assert.equal(verifyModelArtifact(modelArtifact).valid, true);
  assert.equal(modelArtifact.calibration.method, "platt");
  assert.match(modelArtifact.calibrationDataHash, /^[a-f0-9]{64}$/);
  const mutated = JSON.parse(JSON.stringify(modelArtifact));
  mutated.threshold = 0.99;
  assert.equal(verifyModelArtifact(mutated).valid, false);
});

test("synthetic labels are latent outcomes rather than copies of observable features", () => {
  const datasets = generateAllSyntheticDatasets({ seed: 44, size: 350 });
  for (const [profile, records] of Object.entries(datasets)) {
    assert.ok(new Set(records.map((record) => record.hospitalId)).size > 10, profile);
    assert.ok(new Set(records.map((record) => record.familyId)).size > 40, profile);
    for (const feature of FEATURE_NAMES) {
      const values = records.map((record) => Boolean(extractRecordFeatures(record)[feature]));
      const labels = records.map((record) => record.actualFraud);
      assert.equal(values.every((value, index) => value === labels[index]), false, `${profile}:${feature} copied labels`);
    }
  }
});

test("grouped folds leak neither claimants nor providers", () => {
  const rows = toRows(generateSyntheticDataset({ size: 400, seed: 71 }));
  const folds = buildGroupedStratifiedFolds(rows, { folds: 5, seed: 29 });
  assert.equal(folds.length, 5);
  for (const fold of folds) {
    assert.ok(fold.testRows.length > 0);
    assert.equal(assertNoGroupLeakage(fold).valid, true);
  }
});

test("leakage-safe evaluation reports calibration, temporal, confidence, ablation, and inference metrics", () => {
  const result = runLeakageSafeEvaluation(
    generateSyntheticDataset({ profile: "temporal_distribution_shift", size: 350, seed: 93 }),
    { seeds: [11], folds: 5 }
  );
  assert.equal(result.evaluations.length, 5);
  assert.ok(result.confidenceIntervals.prAuc.mean >= 0 && result.confidenceIntervals.prAuc.mean <= 1);
  assert.ok(result.confidenceIntervals.brierScore.mean >= 0);
  assert.ok(result.temporalHoldout.testRecords > 0);
  assert.equal(result.ablations.length, FEATURE_NAMES.length);
  assert.ok(result.performance.meanInferenceTimeMs >= 0);
  assert.ok(result.evaluations.every((item) => item.candidates.some((candidate) => candidate.method === "platt")));
});

test("fuzzy duplicate similarity is advisory while exact signed identity is authoritative", () => {
  const existing = [{
    claimId: "7",
    claimantId: "alice",
    providerSignedInvoiceId: "signed:abc",
    claimType: "SURGERY",
    incidentDate: "2026-05-10",
    invoiceNumber: "INV 2026 000184",
    providerName: "Central Medical",
    documentText: "appendectomy invoice",
    amount: 0.2,
  }];
  const fuzzy = analyzeDuplicateCandidate({
    claimantId: "alice",
    providerSignedInvoiceId: "signed:different",
    claimType: "SURGERY",
    incidentDate: "2026-05-11",
    invoiceNumber: "INV-2026-000184-REV",
    providerName: "Central Medical Ltd",
    documentText: "appendectomy invoice revised",
    amount: 0.205,
  }, existing);
  assert.equal(fuzzy.authoritativeDuplicate, false);
  assert.equal(fuzzy.action, "ADVISORY_MANUAL_REVIEW");
  const exact = analyzeDuplicateCandidate({
    ...existing[0],
    claimId: undefined,
  }, existing);
  assert.equal(exact.authoritativeDuplicate, true);
  assert.equal(exact.action, "AUTHORITATIVE_REJECT");
});
