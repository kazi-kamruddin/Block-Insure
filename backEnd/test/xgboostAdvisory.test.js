const test = require("node:test");
const assert = require("node:assert/strict");
const { ethers } = require("ethers");
const { compile } = require("../../oracle/xgboostAssessment");
const { prepareAdvisoryObservation } = require("../services/advisoryContextService");
const { createAdvisoryService, loadAdvisoryBundle } = require("../services/xgboostAdvisoryService");
const load = require("./helpers/loadIsolatedModule");
const bundle = require("../artifacts/xgboost-advisory-v1.json");
const wallet = `0x${"1".repeat(40)}`;
const record = (id = "current", day = "2026-10-20") => ({ hospitalId: "HOSP-001", patientHash: "patient-A", authorizedClaimants: [wallet],
  treatmentType: "HOSPITALIZATION", diagnosisCode: "D1", admissionDate: `${day}T00:00:00.000Z`, dischargeDate: `${day}T00:00:00.000Z`, invoiceDate: `${day}T00:00:00.000Z`,
  billAmount: "0.1", expectedBillMin: "0.01", expectedBillMax: "1", invoiceNumber: id, invoiceHash: ethers.id(id), invoiceStatus: "VALID", recordStatus: "VALID", licenseStatus: "ACTIVE" });
const claim = { claimId: 1n, claimVersion: 1n, claimantWallet: wallet, claimAmount: ethers.parseEther("0.1"), hospitalId: "HOSP-001",
  invoiceHash: ethers.id("current"), incidentDate: BigInt(Date.parse("2026-10-20") / 1000), claimType: "HOSPITALIZATION", submittedAt: BigInt(Date.parse("2026-10-22") / 1000) };
const snapshotTimestamp = Date.parse("2026-10-23") / 1000;
const facts = { ...claim, claimAmountEth: "0.1" };
const prepared = (records = [record()]) => prepareAdvisoryObservation({ records, claim: facts, snapshotTimestamp });
const input = { claim, claimVersion: "1", deploymentId: "31337:deployment-A", registryRoot: ethers.id("root"), registryVersion: "1", snapshotTimestamp, blockHash: ethers.id("block") };

test("packaged XGBoost loads with validated model and observable-source identities", () => {
  assert.equal(loadAdvisoryBundle().bundle.provenance.seed, 503);
  assert.equal(loadAdvisoryBundle().bundle.policy.authority, "ADMIN_ADVISORY_ONLY");
});

test("advisory contract readers exist in the deployed ABIs", () => {
  for (const [artifact, names] of [
    [require("../abi/InsuranceManager.json"), ["getClaim", "claimVersion", "claimCounter"]],
    [require("../abi/OracleCoordinator.json"), ["requestByClaimId", "getRequest", "currentRegistryVersion", "getRegistrySnapshot"]],
  ]) {
    const iface = new ethers.Interface(artifact.abi);
    for (const name of names) assert.ok(iface.getFunction(name), `Missing deployed reader ${name}`);
  }
});

test("balanced advisory retains uncertainty without each warning forcing review", () => {
  const candidate = structuredClone(bundle); candidate.policy.threshold = 1.000000000001; candidate.policy.thresholdUnits = 1000000001;
  candidate.pipeline.ood.threshold = -1;
  const result = compile(candidate).score(prepared().observation);
  assert.equal(result.uncertainty.ood.warning, true);
  assert.equal(result.uncertainty.triggersReview, false);
  assert.equal(result.recommendation, "NO_ADDITIONAL_MODEL_REVIEW");
  assert.equal(result.transactionCreated, false);
  assert.equal(result.policy.runtimeCapacityGuarantee, false);
});

test("existing integrity rules survive every score/uncertainty policy", () => {
  const candidate = structuredClone(bundle); candidate.policy.threshold = 1.000000000001; candidate.policy.thresholdUnits = 1000000001;
  const result = compile(candidate).score({ ...prepared().observation, mandatory: true });
  assert.equal(result.recommendation, "REVIEW_RECOMMENDED");
  assert.deepEqual(result.reasons, ["INTEGRITY_OR_EXISTING_REVIEW_RULE"]);
});

test("runtime context excludes current invoice, same-day, future and old entries", () => {
  const a = prepared([record(), record("earlier", "2026-10-19"), record("same-day"), record("future", "2026-10-21"), record("old", "2026-01-01")]);
  assert.equal(a.context.eligiblePriorRecords, 1);
  assert.equal(a.observation.features.history_patient14, Math.log1p(1));
  assert.deepEqual(a.observation.providerLags, [1]);
});

test("history comes from matching committed identities, never forged label/history flags", () => {
  const before = prepared([record(), record("prior", "2026-10-19")]);
  const after = prepared([record(), record("prior", "2026-10-19")].map((r) => ({ ...r,
    fraudLabel: "FRAUD", providerPotentialFraud: true, actualFraud: true, controlledAttackTruth: true,
    observableHistory: { previousClaimCount: 999999, providerVelocityAnomaly: true }, scenarioType: "ATTACK", nearDuplicateAdvisory: true,
  })));
  assert.deepEqual(after, before);
  const otherPatient = prepared([record(), { ...record("other", "2026-10-19"), patientHash: "patient-B" }]);
  assert.equal(otherPatient.observation.features.history_patient14, 0);
  assert.equal(otherPatient.context.providerHistoryAvailable, true);
});

test("unknown history is explicit and does not fabricate feature evidence", () => {
  const result = prepared();
  assert.equal(result.context.historyAvailable, false);
  assert.equal(result.observation.features.history_available, 0);
  assert.deepEqual(result.observation.providerLags, []);
});

test("missing/duplicate/invalid/oversized context is rejected instead of becoming zero risk", () => {
  assert.throws(() => prepared([]), /INVOICE_NOT_IN_COMMITTED_SNAPSHOT/);
  assert.throws(() => prepared([record(), record()]), /DUPLICATE_CONTEXT_IDENTITY/);
  assert.throws(() => prepared([{ ...record(), billAmount: "NaN" }]), /INVALID_CONTEXT_RECORD/);
  assert.throws(() => prepared(Array(10001).fill(record())), /CONTEXT_LIMIT_EXCEEDED/);
});

test("claimant ownership is a mandatory finding independently of model score", () => {
  const result = prepareAdvisoryObservation({ records: [record()], claim: { ...facts, claimantWallet: `0x${"2".repeat(40)}` }, snapshotTimestamp });
  assert.equal(result.observation.mandatory, true);
});

test("exact explanations add to the unrounded model margin; malformed input fails", () => {
  const engine = compile(bundle), observation = prepared().observation, result = engine.score(observation);
  assert.ok(result.explanation.additivityError < 1e-4);
  assert.equal(result.explanation.scale, "raw_margin");
  assert.throws(() => engine.score({ ...observation, features: {} }), /Missing/);
  assert.throws(() => engine.score({ ...observation, providerLags: [0] }), /history/);
  assert.throws(() => engine.score({ ...observation, mandatory: "false" }), /Explicit/);
});

test("concurrent reads share one immutable assessment; caller mutations cannot poison cache", async () => {
  let reads = 0, writes = 0;
  const assess = createAdvisoryService({ readRecords: async () => { reads++; return [record()]; }, persist: async () => { writes++; } });
  const results = await Promise.all(Array.from({ length: 6 }, () => assess(input)));
  assert.equal(reads, 1); assert.equal(writes, 1);
  assert.equal(new Set(results.map((r) => r.assessmentId)).size, 1);
  assert.equal(results[0].primaryModel, "XGBoost");
  assert.equal(results[0].mode, "PROTOCOL_SHADOW");
  results[0].assessment.riskScore = -1;
  assert.ok((await assess(input)).assessment.riskScore >= 0);
  const text = JSON.stringify(results[1]);
  assert.equal(text.includes("patient-A"), false);
  assert.equal(text.includes(wallet), false);
  assert.equal(text.includes("canonicalRecord"), false);
});

test("cache and durable identity isolate deployments, claim facts, versions and roots", async () => {
  const assess = createAdvisoryService({ readRecords: async () => [record()], persist: async () => {} });
  const inputs = [input, { ...input, deploymentId: "31337:deployment-B" }, { ...input, claimVersion: "2" },
    { ...input, registryRoot: ethers.id("other-root") }, { ...input, claim: { ...claim, claimAmount: ethers.parseEther("0.11") } }];
  const identities = [];
  for (const value of inputs) identities.push((await assess(value)).assessmentId);
  assert.equal(new Set(identities).size, inputs.length);
});

test("failed inference/storage is retryable and never silently supplies NB", async () => {
  let reads = 0;
  const assess = createAdvisoryService({ readRecords: async () => { if (++reads === 1) throw new Error("Unavailable"); return [record()]; }, persist: async () => {} });
  await assert.rejects(assess(input), /Unavailable/);
  assert.equal((await assess(input)).primaryModel, "XGBoost");
  const broken = createAdvisoryService({ readRecords: async () => [record()], persist: async () => { throw new Error("Storage unavailable"); } });
  await assert.rejects(broken(input), /Storage unavailable/);
});

test("bounded concurrent assessments reject excess work without losing ongoing work", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const assess = createAdvisoryService({ readRecords: async () => { await gate; return [record()]; }, persist: async () => {} });
  const first = assess(input), second = assess({ ...input, claimVersion: "2" });
  await assert.rejects(assess({ ...input, claimVersion: "3" }), (error) => error.code === "ADVISORY_BUSY");
  release();
  assert.equal((await first).status, "AVAILABLE");
  assert.equal((await second).status, "AVAILABLE");
});

function controller(doubles = {}) {
  let calls = 0, assessmentArgs;
  const coordinator = { currentRegistryVersion: async () => 1n, requestByClaimId: async () => 0n,
    getRegistrySnapshot: async () => ({ root: input.registryRoot, publishedAt: snapshotTimestamp }),
    getRequest: async () => ({ claimVersion: 1n, registryVersion: 7n }),
  };
  const claimContract = { getClaim: async () => claim, claimVersion: async () => 1n, claimCounter: async () => 2n,
    getAddress: async () => `0x${"3".repeat(40)}`, runner: { provider: { getBlock: async (n) => ({ number: n === "latest" ? 12 : n, hash: ethers.id(String(n === "latest" ? 12 : n)) }), getNetwork: async () => ({ chainId: 31337n }) } } };
  const endpoint = load("controllers/advisoryController.js", {
    "../services/contractService": { getReadOnlyContract: () => { calls++; return claimContract; }, getOracleCoordinator: async () => coordinator },
    "../services/xgboostAdvisoryService": { createAdvisoryService: () => async (args) => { assessmentArgs = args; return { status: "AVAILABLE", primaryModel: "XGBoost" }; } }, ...doubles,
  }).getClaimAdvisory;
  const invoke = async (req) => {
    const res = { statusCode: 200, set: () => {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await endpoint(req, res, (error) => { res.error = error; }); return res;
  };
  return { invoke, calls: () => calls, claimContract, coordinator, assessmentArgs: () => assessmentArgs };
}

test("advisory endpoint enforces Admin-only access and validates IDs before dependencies", async () => {
  const endpoint = controller();
  for (const role of ["USER", "AUDITOR", "HOSPITAL", "BANK", undefined]) assert.equal((await endpoint.invoke({ user: { role }, params: { claimId: "1" } })).statusCode, 403);
  for (const id of ["0", "-1", "1x", "1.2", "999999999999999999999999", { $gt: "" }]) assert.equal((await endpoint.invoke({ user: { role: "ADMIN" }, params: { claimId: id } })).statusCode, 400);
  assert.equal(endpoint.calls(), 0);
  assert.equal((await endpoint.invoke({ user: { role: "ADMIN" }, params: { claimId: "2" } })).statusCode, 404);
});

test("controller uses publishedAt and hides internal failures; reorgs reject stale responses", async () => {
  const endpoint = controller();
  assert.equal((await endpoint.invoke({ user: { role: "ADMIN" }, params: { claimId: "1" } })).body.advisory.primaryModel, "XGBoost");
  assert.equal(endpoint.assessmentArgs().snapshotTimestamp, snapshotTimestamp);
  const broken = controller({ "../services/xgboostAdvisoryService": { createAdvisoryService: () => async () => { throw new Error("sensitive internal error"); } } });
  const response = await broken.invoke({ user: { role: "ADMIN" }, params: { claimId: "1" } });
  assert.equal(response.error.statusCode, 503);
  assert.equal(response.error.message.includes("sensitive"), false);
  const reorg = controller(); let queries = 0;
  reorg.claimContract.runner.provider.getBlock = async () => ({ number: 12, hash: ethers.id(String(++queries)) });
  assert.equal((await reorg.invoke({ user: { role: "ADMIN" }, params: { claimId: "1" } })).statusCode, 409);
});

test("current Oracle request pins historical root/version; stale appeal requests do not", async () => {
  const endpoint = controller();
  endpoint.coordinator.requestByClaimId = async () => 9n;
  let requested;
  endpoint.coordinator.getRegistrySnapshot = async (version) => { requested = version; return { root: input.registryRoot, publishedAt: snapshotTimestamp }; };
  await endpoint.invoke({ user: { role: "ADMIN" }, params: { claimId: "1" } });
  assert.equal(requested, 7n);
  assert.equal(endpoint.assessmentArgs().requestId, "9");
  endpoint.coordinator.getRequest = async () => ({ claimVersion: 0n, registryVersion: 7n });
  await endpoint.invoke({ user: { role: "ADMIN" }, params: { claimId: "1" } });
  assert.equal(requested, 1n);
  assert.equal(endpoint.assessmentArgs().requestId, "0");
});

test("claim changes during assessment reject stale output, unavailable context is explicit", async () => {
  const endpoint = controller(); let versions = 0;
  endpoint.claimContract.claimVersion = async () => BigInt(++versions);
  assert.equal((await endpoint.invoke({ user: { role: "ADMIN" }, params: { claimId: "1" } })).statusCode, 409);
  const unavailable = controller({ "../services/xgboostAdvisoryService": { createAdvisoryService: () => async () => {
    throw Object.assign(new Error("internal patient details"), { code: "INVOICE_NOT_IN_COMMITTED_SNAPSHOT" });
  } } });
  const response = await unavailable.invoke({ user: { role: "ADMIN" }, params: { claimId: "1" } });
  assert.equal(response.body.advisory.status, "UNAVAILABLE");
  assert.equal(response.body.advisory.reason, "INVOICE_NOT_IN_COMMITTED_SNAPSHOT");
  assert.equal(JSON.stringify(response.body).includes("patient details"), false);
});
