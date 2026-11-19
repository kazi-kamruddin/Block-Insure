const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { sourceDifferences, verifySourceTransition } = require('../../scripts/researchSourceTransition');
const { run: build } = require('../scripts/generateResearchManifest');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root,p));
const sha = p => crypto.createHash('sha256').update(read(p)).digest('hex');
const recorded = JSON.parse(read('backEnd/evaluation-results/research-manifest-v4.json'));
const receipt = JSON.parse(read('docs/research-source-transition-claim-workflow.json'));
const historicalSha = sha('backEnd/evaluation-results/research-manifest-v4.json');

test('current reviewed transition matches actual source without replacing historical provenance', () => {
  assert.equal(verifySourceTransition(recorded, build({writeOutput:false}), receipt, historicalSha), true);
  assert.equal(sha(receipt.previousTransition), receipt.previousTransitionSha256);
  assert.equal(receipt.evidenceStatus, 'HISTORICAL_NOT_REVALIDATED');
  const previous = JSON.parse(read(receipt.previousTransition));
  assert.equal(previous.historicalManifestSha256, historicalSha);
  assert.equal(previous.historicalReproducibilityHash, recorded.reproducibilityHash);
});

test('current transition rejects changed runtime, model, dataset and measurement bindings', () => {
  const current = build({writeOutput:false});
  for (const mutate of [
    value => {value.implementation['oracle/runtimeProtocol.js'] = 'unreviewed';},
    value => {value.implementation['unreviewed-runtime.js'] = 'added';},
    value => {value.artifacts.protocolRouting.modelIdentityHash = 'unreviewed';},
    value => {value.artifacts.unreviewedMeasurement = 'changed';},
    value => {value.implementation['backEnd/datasets/unreviewed.json'] = 'changed';},
  ]) {
    const changed = structuredClone(current); mutate(changed);
    assert.equal(verifySourceTransition(recorded, changed, receipt, historicalSha), false);
  }
  assert.equal(verifySourceTransition(recorded, current, receipt, 'modified-history'), false);
  const omitted = structuredClone(receipt); omitted.changes.pop();
  assert.equal(verifySourceTransition(recorded, current, omitted, historicalSha), false);
  const noReason = structuredClone(receipt); noReason.changes[0].reason = '';
  assert.equal(verifySourceTransition(recorded, current, noReason, historicalSha), false);
});

test('old reviewed transition is preserved but cannot authorize the current v5 source', () => {
  const previous = JSON.parse(read(receipt.previousTransition));
  const current = build({writeOutput:false});
  assert.equal(verifySourceTransition(recorded, current, previous, historicalSha), false);
  assert.ok(sourceDifferences(recorded, current).length > 0);
});
