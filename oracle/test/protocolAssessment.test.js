const test = require("node:test"), assert = require("node:assert/strict");
const fixture = require("../../backEnd/test/helpers/shadowFixture");
const { assessProtocol, unavailable } = require("../protocolAssessment");
const { loadProtocolArtifact, resolveRequestModel, buildProtocolArtifact } = require("../runtimeProtocol");
const { binding, hash } = require("../shadowAssessment");

test("active XGBoost artifact binds model, context sources, decision policy and frozen historical model", () => {
  const active = loadProtocolArtifact();
  assert.deepEqual(active, buildProtocolArtifact());
  assert.equal(resolveRequestModel(active.modelIdentityHash).kind, "xgboost");
  assert.equal(resolveRequestModel(active.legacyModelIdentityHash).kind, "legacy-nb");
  assert.throws(() => resolveRequestModel(`0x${"9".repeat(64)}`), /Unsupported/);
});
test("same complete context produces deterministic routing and changing request version changes commitment code", () => {
  const f = fixture();
  const first = assessProtocol(f.packet, f.authoritative);
  assert.equal(first.model, "XGBoost"); assert.equal(first.authority, "ORACLE_ROUTING");
  assert.equal(first.verified, true); assert.deepEqual(first, assessProtocol(f.packet, f.authoritative));
  const a = { ...f.authoritative, request: { ...f.authoritative.request, claimVersion: "2" } };
  const bound = binding({ ...a, bundleHash: f.loaded.bundleHash, manifestHash: f.loaded.manifestHash });
  const second = assessProtocol({ ...f.packet, binding: bound, contextId: hash(bound) }, a);
  assert.equal(first.score, second.score); assert.notEqual(first.verificationCode, second.verificationCode);
});
test("threshold equality reviews while uncertainty alone does not impose review", () => {
  const f = fixture(), { compile } = require("../xgboostAssessment");
  const baseline = assessProtocol(f.packet, f.authoritative);
  // Test the real inference engine, with a test-only policy clone. No packaged
  // artifact or production threshold is modified.
  const bundle = structuredClone(f.loaded.bundle);
  bundle.policy.thresholdUnits = baseline.assessment.result.scoreUnits + 1;
  bundle.policy.threshold = bundle.policy.thresholdUnits / 1e9;
  bundle.pipeline.ood.threshold = -1;
  bundle.pipeline.conformal.quantile = { "0": 1, "1": 1 };
  const loaded = { ...f.loaded, engine: compile(bundle) };
  const warning = assessProtocol(f.packet, f.authoritative, loaded);
  assert.equal(warning.assessment.result.oodWarning, true);
  assert.equal(warning.assessment.result.predictionSet.length, 2);
  assert.equal(warning.verified, true);
  bundle.policy.thresholdUnits--;
  bundle.policy.threshold = bundle.policy.thresholdUnits / 1e9;
  loaded.engine = compile(bundle);
  const equality = assessProtocol(f.packet, f.authoritative, loaded);
  assert.equal(equality.verified, false);
  assert.equal(equality.uncertaintyTriggersReview, false);
});
test("tampered archive and request context cannot produce an automatic result", () => {
  const f = fixture();
  assert.throws(() => assessProtocol({ ...f.packet, records: [] }, f.authoritative));
  assert.throws(() => assessProtocol({ ...f.packet, binding: { ...f.packet.binding, registryVersion: "22" } }, f.authoritative));
  assert.equal(unavailable().verified, false); assert.equal(unavailable().score, null);
});
test("malformed inference scores or recommendations cannot authorize automatic verification", () => {
  const f = fixture();
  for (const [riskScoreUnits, recommendation] of [[NaN, "NO_ADDITIONAL_MODEL_REVIEW"], [Infinity, "NO_ADDITIONAL_MODEL_REVIEW"],
    [-1, "NO_ADDITIONAL_MODEL_REVIEW"], [1000000001, "NO_ADDITIONAL_MODEL_REVIEW"], [1, "UNKNOWN"]]) {
    const loaded = { ...f.loaded, engine: { score: () => ({ riskScoreUnits, recommendation, reasons: [],
      uncertainty: { predictionSet: [], ood: { warning: true } }, policy: { version: "test", thresholdUnits: 10 }, explanation: {} }) } };
    assert.throws(() => assessProtocol(f.packet, f.authoritative, loaded), /Invalid protocol inference/);
  }
});
