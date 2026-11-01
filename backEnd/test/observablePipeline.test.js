const test = require("node:test");
const assert = require("node:assert/strict");
const { extractObservableRecordFeatures, extractRuntimeFeatures, claimForRecord } = require("../services/featureEngineeringService");
const { extractProofBoundFeatures, compareCommittedRecord } = require("../../oracle/independentAssessment");
const { generateSyntheticDataset } = require("../services/syntheticRegistryService");
const { injectObservableScenario } = require("../services/hybridDatasetAdapterService");
const { trainModelParams } = require("../services/modelTrainingService");
const { vectorize, trainLogisticRegression, predictLogisticRegression } = require("../services/logisticRegressionService");
const { continuousFeatures } = require("../services/continuousFeatureService");
const load = require("./helpers/loadIsolatedModule");

test("training, backend and independent workers consume identical observable feature vectors", () => {
  for (const record of generateSyntheticDataset({ seed: 91, size: 100 })) {
    const claim = claimForRecord(record);
    const comparison = compareCommittedRecord({ record, claim });
    const fieldChecks = Object.fromEntries(Object.entries(comparison).map(([name, matched]) => [name, { matched }]));
    assert.deepEqual(extractObservableRecordFeatures(record), extractProofBoundFeatures({ record, comparison }));
    assert.deepEqual(extractRuntimeFeatures({ record, comparison: { fieldChecks } }), extractProofBoundFeatures({ record, comparison }));
  }
});

test("training ignores answer-key flags while retaining labels only as targets", () => {
  const records = generateSyntheticDataset({ seed: 71, size: 60 });
  const mutated = records.map((record) => ({ ...record, fraudSignals: { inflatedAmount: true, dateMismatch: true },
    providerVelocityAnomaly: !record.providerVelocityAnomaly, nearDuplicateAdvisory: true, previousClaimCount: 9999 }));
  const metadata = { trainedAt: "2026-10-24T00:00:00.000Z" };
  assert.deepEqual(trainModelParams(records, metadata), trainModelParams(mutated, metadata));
  assert.notEqual(trainModelParams(records, metadata).trainingDataHash,
    trainModelParams(records.map((record) => ({ ...record, actualFraud: !record.actualFraud })), metadata).trainingDataHash);
});

test("missing bill-range metadata abstains consistently rather than approving unknown bounds", () => {
  const record = { ...generateSyntheticDataset({ size: 1 })[0], expectedBillMin: undefined, expectedBillMax: undefined };
  const comparison = compareCommittedRecord({ record, claim: claimForRecord(record) });
  const workerFeatures = extractProofBoundFeatures({ record, comparison });
  const backendFeatures = extractRuntimeFeatures({ record, comparison: { fieldChecks: { expectedBillRange: { matched: false } } } });
  assert.equal(workerFeatures.bill_range_anomaly, true);
  assert.equal(backendFeatures.bill_range_anomaly, true);
});

test("scenarios change real comparison inputs or explicitly remain unobservable negative controls", () => {
  const base = { ...generateSyntheticDataset({ seed: 4, size: 1 })[0], invoiceStatus: "VALID", recordStatus: "VALID", licenseStatus: "ACTIVE" };
  const seen = new Set();
  for (let index = 0; index < 200; index++) {
    const record = { ...base, sourceClaimId: `observable-${index}` };
    const attacked = injectObservableScenario(record, { rate: 1 });
    seen.add(attacked.scenarioType);
    const before = extractObservableRecordFeatures(record);
    const after = extractObservableRecordFeatures(attacked);
    if (["PROVIDER_COMPROMISE", "NEAR_DUPLICATE"].includes(attacked.scenarioType)) {
      assert.deepEqual(after, before);
      assert.match(attacked.scenarioObservability, /No changed proof-bound/);
    }
    if (attacked.scenarioType === "DATE_MISMATCH") assert.equal(after.date_mismatch, true);
    assert.equal(attacked.observedClaim.claimAmountEth, record.billAmount);
    assert.deepEqual(attacked.observableHistory, record.observableHistory);
  }
  assert.equal(seen.size, 8);
});

test("continuous baseline preserves numerical magnitudes and rejects malformed inputs", () => {
  assert.deepEqual(vectorize(["x"], { x: 0.25 }, "continuous"), [0.25]);
  assert.deepEqual(vectorize(["x"], { x: 0.25 }), [1]);
  assert.throws(() => vectorize(["x"], { x: Infinity }, "continuous"), /Non-finite/);
  const model = trainLogisticRegression({ featureNames: ["x"], inputEncoding: "continuous",
    rows: [{ actualFraud: false, features: { x: -2 } }, { actualFraud: true, features: { x: 2 } }], iterations: 100 });
  assert.ok(predictLogisticRegression(model, { x: 2 }).fraudProbability > predictLogisticRegression(model, { x: 0.1 }).fraudProbability);
  const record = generateSyntheticDataset({ size: 1 })[0];
  assert.deepEqual(continuousFeatures(record), continuousFeatures({ ...record, fraudLabel: "FRAUD", sourceProcedureCode: "", fraudSignals: { inflatedAmount: true }, previousClaimCount: 999 }));
});

test("invoice readiness does not disclose another patient's existence or identifiers", async () => {
  const walletAddress = `0x${"1".repeat(40)}`;
  let record = null, query;
  const controller = load("controllers/claimController.js", {
    "../models/MockHospitalRecord": { findOne: (filter) => { query = filter; return { select: () => ({ lean: async () => record }) }; } },
  });
  const call = async (body) => {
    let result, failure;
    const response = { set: (key, value) => assert.equal(`${key}:${value}`, "Cache-Control:no-store"), json: (value) => { result = value; } };
    await controller.previewInvoiceEligibility({ user: { walletAddress }, body }, response, (error) => { failure = error; });
    return { result, failure };
  };
  const input = { hospitalId: "HOSP-001", invoiceHash: `0x${"a".repeat(64)}` };
  assert.equal((await call(input)).result.boundToCurrentWallet, false);
  assert.equal(query.authorizedClaimants, walletAddress);
  record = { publicationPending: true, recordStatus: "VALID", invoiceStatus: "VALID", licenseStatus: "ACTIVE" };
  const own = (await call(input)).result;
  assert.equal(own.boundToCurrentWallet, true);
  assert.equal(own.publicationPending, true);
  assert.equal(own.patientHash, undefined);
  assert.equal((await call({ hospitalId: { $ne: "" }, invoiceHash: input.invoiceHash })).failure.statusCode, 400);
});
