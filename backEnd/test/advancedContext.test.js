const test = require('node:test');
const assert = require('node:assert/strict');
const { createContextIndex, observation } = require('../research/context');
const { predict } = require('../research/predict');
const row = (date, extra = {}) => ({ admissionDate: date, billAmount: 1, patientHash: 'p', hospitalId: 'h', treatmentType: 'INPATIENT', diagnosisCode: 'D', ...extra });
test('advanced context excludes same-day and future records', () => {
  const index = createContextIndex(); for (const r of [row('2020-01-01'), row('2020-01-02'), row('2020-01-03')]) index.add(r); index.seal();
  const value = index.query(row('2020-01-02'));
  assert.equal(value.providerLags.length, 1); assert.equal(value.providerLags[0], 1);
  assert.equal(value.features.history_similar, Math.log1p(1));
});
test('advanced context cannot consume labels, answer-key flags or weak provider targets', () => {
  const a = createContextIndex(), b = createContextIndex(); const original = row('2020-01-01');
  a.add(original); b.add({ ...original, fraudLabel: 'ATTACK', controlledAttackTruth: true, providerPotentialFraud: true, fraudSignals: { nearDuplicate: true } });
  a.seal(); b.seal(); assert.deepEqual(a.query(row('2020-01-05')), b.query(row('2020-01-05', { fraudLabel: 'ATTACK', controlledAttackTruth: true })));
});
test('advanced graph does not confuse a common provider with patient identity', () => {
  const index = createContextIndex(); index.add(row('2020-01-01', { patientHash: 'other' })); index.seal();
  const value = index.query(row('2020-01-02')); assert.equal(value.features.history_similar, 0); assert.equal(value.features.graph_edge_repeat_share, 0);
});
test('advanced context handles cold start and rejects invalid records', () => {
  const index = createContextIndex(); index.seal(); const cold = index.query(row('2020-01-02'));
  assert.equal(cold.features.history_available, 0); assert.deepEqual(cold.providerLags, []);
  assert.equal(observation(row('invalid')), null); assert.throws(() => index.query(row('invalid')));
});
test('advanced graph context is independent of prior-record insertion order', () => {
  const observations = Array.from({ length: 40 }, (_, i) => row(`2020-01-${String(1 + i % 10).padStart(2, '0')}`, { patientHash: `p${i % 7}`, hospitalId: `h${i % 3}`, billAmount: 1 + i % 4 }));
  const a = createContextIndex(), b = createContextIndex();
  for (const r of observations) a.add(r); for (const r of observations.toReversed()) b.add(r);
  a.seal(); b.seal(); assert.deepEqual(a.query(row('2020-01-15', { patientHash: 'p1', hospitalId: 'h1' })), b.query(row('2020-01-15', { patientHash: 'p1', hospitalId: 'h1' })));
});
test('offline research remains outside the authoritative NB/Oracle verification path', () => {
  const fs = require('node:fs'), path = require('node:path');
  for (const name of ['services/riskScoringService.js', '../oracle/independentAssessment.js', '../oracle/index.js']) {
    const source = fs.readFileSync(path.resolve(__dirname, '..', name), 'utf8');
    assert.doesNotMatch(source, /research\/(?:run|infer|context)|advanced-candidate-v1/);
  }
});
test('portable tree reference enforces schema, finite inputs and float32 split boundary', () => {
  const model = { schema: 'advanced-trees-v1', baseMargin: 0, features: ['x'], trees: [{ nodeid: 0, split: 'x', split_condition: 1, yes: 1, no: 2, children: [{ nodeid: 1, leaf: -1 }, { nodeid: 2, leaf: 1 }] }] };
  const values = predict(model, [[0], [1]]); assert.ok(values[0].probability < 0.5); assert.ok(values[1].probability > 0.5);
  assert.throws(() => predict(model, [[NaN]])); assert.throws(() => predict(model, [[]])); assert.throws(() => predict({ ...model, baseMargin: 1 }, [[0]]));
});
