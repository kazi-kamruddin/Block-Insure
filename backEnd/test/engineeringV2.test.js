const test = require('node:test'), assert = require('node:assert/strict');
const { engineer } = require('../research/scenariosV2');
const { createContextIndex } = require('../research/context');
const { prepareRecord } = require('../research/exportV2');
const plan = require('../research/engineering-plan-v2.json');
const base = { sourceClaimId: 'source-A', patientHash: 'patient-A', hospitalId: 'hospital-A', diagnosisCode: 'D1', treatmentType: 'DIAGNOSTIC',
  admissionDate: '2009-02-10T00:00:00.000Z', dischargeDate: '2009-02-12T00:00:00.000Z', invoiceDate: '2009-02-12T00:00:00.000Z', observationDate: '2009-02-12T00:00:00.000Z',
  billAmount: '1.0000', expectedBillMin: '.1', expectedBillMax: '4', invoiceHash: '0x123', invoiceStatus: 'VALID', recordStatus: 'VALID', licenseStatus: 'ACTIVE' };
function generated(family, source = base) { return engineer(source, { seed: 503, rate: .12, plan, forcedFamily: family, forcedSeverity: 1.5 }); }
test('v2 generator is deterministic and never changes its source record', () => {
  const before = structuredClone(base); assert.deepEqual(generated('COHERENT_BILL_INFLATION'), generated('COHERENT_BILL_INFLATION')); assert.deepEqual(base, before);
});
test('v2 generator ignores provider weak labels and existing fraud answer keys', () => {
  const altered = { ...base, providerPotentialFraud: true, fraudLabel: 'FRAUD', controlledAttackTruth: true };
  const a = generated('CONCEALED_PHANTOM_BILLING'), b = generated('CONCEALED_PHANTOM_BILLING', altered);
  const context = createContextIndex(); context.seal();
  assert.deepEqual(prepareRecord(base, context, a), prepareRecord(base, context, b));
});
test('opposite-intent engineered twins have identical predictor inputs', () => {
  const context = createContextIndex(); context.seal();
  for (const [attack, benign] of [['COHERENT_BILL_INFLATION', 'BENIGN_HIGH_COST'], ['REPEATED_SERVICE_BILLING', 'BENIGN_REPEAT_CARE'], ['COORDINATED_BILLING_BURST', 'BENIGN_PROVIDER_SURGE'], ['CONCEALED_PHANTOM_BILLING', 'UNCHANGED_CONTROL']]) {
    const a = prepareRecord(base, context, generated(attack)), b = prepareRecord(base, context, generated(benign));
    assert.equal(a.target, true); assert.equal(b.target, false); assert.deepEqual(a.features, b.features); assert.deepEqual(a.providerLags, b.providerLags);
  }
});
test('replay identity and phantom-service intent have explicit simulator facts', () => {
  const replay = generated('INVOICE_REPLAY');
  assert.equal(replay.observable.events[0].invoiceHash, base.invoiceHash);
  assert.equal(replay.observable.record.invoiceStatus, 'USED');
  assert.equal(generated('CONCEALED_PHANTOM_BILLING').truth.latentSimulationFacts.serviceRenderedAssumption, false);
  assert.equal(generated('UNCHANGED_CONTROL').truth.latentSimulationFacts.serviceRenderedAssumption, true);
});
test('engineering preserves prior event chronology and avoids current/future availability', () => {
  const result = generated('REPEATED_SERVICE_BILLING');
  for (const event of result.observable.events) {
    assert.ok(Date.parse(event.admissionDate) <= Date.parse(event.dischargeDate));
    assert.ok(Date.parse(event.invoiceDate) < Date.parse(base.observationDate));
  }
  const context = createContextIndex();
  context.add({ ...base, admissionDate: '2009-01-01', observationDate: '2009-03-01' }); context.seal();
  assert.equal(context.query(base).features.history_available, 0);
});
test('model inputs reflect actions, not thresholds defining the answer', () => {
  const context = createContextIndex(); context.seal();
  assert.equal(prepareRecord(base, context, generated('AMOUNT_INCONSISTENCY')).mandatory, true);
  const high = generated('BENIGN_HIGH_COST'); high.observable.record.billAmount = '1000'; high.observable.claim.claimAmountEth = '1000';
  const row = prepareRecord(base, context, high);
  assert.equal(row.target, false); assert.equal(row.mandatory, true); // nuisance false route must not be relabelled away
});
test('held-out family is absent from train generator; seeds vary interventions', () => {
  const families = new Set(), decisions = new Set();
  for (let i = 0; i < 150; i++) {
    const record = { ...base, sourceClaimId: `source-${i}` };
    const result = engineer(record, { seed: 503, rate: 1, plan, cohort: 'train' }); families.add(result.truth.family);
    decisions.add(JSON.stringify(plan.seeds.map((seed) => engineer(record, { seed, rate: .12, plan }).truth.intentionalIntervention)));
  }
  assert.equal(families.has(plan.heldOutFamily), false); assert.ok(decisions.size > 1);
});
