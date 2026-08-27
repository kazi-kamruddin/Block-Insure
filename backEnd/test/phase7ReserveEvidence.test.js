const assert = require("node:assert/strict");
const test = require("node:test");
const {
  SCENARIOS,
  calculateInsurerLiability,
  evaluateCapital,
  evaluateReserveAdequacy,
  generateAnnualLosses,
} = require("../services/reserveSimulationService");
const {
  LocalContentAddressedStore,
  canTransformForGrant,
  decryptEvidence,
  deterministicDocument,
  encryptEvidence,
  runAdversarialChecks,
} = require("../services/evidenceBenchmarkService");

test("settlement liability mirrors deductible, cap, share, and coverage boundaries", () => {
  assert.equal(calculateInsurerLiability(2), 0.784);
  assert.equal(calculateInsurerLiability(0), 0);
  assert.ok(Math.abs(calculateInsurerLiability(0.1) - 0.072) < 1e-12);
});

test("reserve loss generation is deterministic and stress increases loss", () => {
  const options = { periods: 250, policies: 200, seed: 91 };
  const first = generateAnnualLosses({ ...options, scenario: SCENARIOS.baseline });
  const second = generateAnnualLosses({ ...options, scenario: SCENARIOS.baseline });
  const stress = generateAnnualLosses({ ...options, scenario: SCENARIOS.combined_stress });
  assert.deepEqual(first, second);
  assert.ok(
    stress.losses.reduce((sum, value) => sum + value, 0) >
      first.losses.reduce((sum, value) => sum + value, 0)
  );
});

test("additional reserve capital monotonically reduces simulated shortfall risk", () => {
  const losses = [1, 2, 3, 4, 5];
  const low = evaluateCapital(losses, 2);
  const high = evaluateCapital(losses, 4);
  assert.ok(high.shortfallProbability < low.shortfallProbability);
  assert.ok(high.expectedUnfundedFraction < low.expectedUnfundedFraction);
});

test("reserve study remains advisory and reports the current five-percent baseline", () => {
  const result = evaluateReserveAdequacy({ periods: 300, policies: 200 });
  assert.equal(result.methodology.advisoryOnly, true);
  assert.equal(result.methodology.currentOnChainReserveRatio, 0.05);
  assert.equal(result.scenarios.length, 4);
  assert.ok(result.scenarios.every((scenario) => scenario.currentFivePercentPolicy));
});

test("evidence encryption round trips and content addressing rejects substituted identifiers", () => {
  const document = deterministicDocument({ key: "test", mediaType: "application/pdf", bytes: 4096 });
  const key = Buffer.alloc(32, 3);
  const aad = Buffer.from("claim:1:version:1");
  const envelope = encryptEvidence(document, key, aad, Buffer.alloc(12, 4));
  assert.deepEqual(decryptEvidence(envelope, key, aad), document);
  assert.throws(() => decryptEvidence(envelope, key, Buffer.from("claim:1:version:2")));
  const store = new LocalContentAddressedStore();
  const cid = store.put(envelope.ciphertext);
  assert.deepEqual(store.get(cid), envelope.ciphertext);
  assert.throws(() => store.get(`${cid}-substituted`));
});

test("revocation and identity rotation deny future proxy transformations", () => {
  assert.equal(canTransformForGrant({
    grant: { granteeKeyVersion: 1, revoked: false },
    identity: { version: 1, revoked: false },
  }), true);
  assert.equal(canTransformForGrant({
    grant: { granteeKeyVersion: 1, revoked: true },
    identity: { version: 1, revoked: false },
  }), false);
  assert.equal(canTransformForGrant({
    grant: { granteeKeyVersion: 1, revoked: false },
    identity: { version: 2, revoked: false },
  }), false);
});

test("all defined evidence adversarial manipulations are detected", () => {
  const result = runAdversarialChecks();
  assert.equal(result.total, 8);
  assert.equal(result.detected, result.total);
  assert.equal(result.detectionRate, 1);
});
