const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { canonicalize } = require('../modelArtifact');
const entry = require.resolve('../runtimeProtocol'), root = path.resolve(__dirname, '../..');
const realRequire = createRequire(entry);
const releasePath = path.join(root, 'backEnd/artifacts/oracle-runtime-compatibility-v2.json');
const profilePath = path.join(root, 'backEnd/artifacts/xgboost-protocol-v4.json');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function isolated({ editFile, editRelease, editLoaded } = {}) {
  const context = { __dirname: path.dirname(entry), module: { exports: {} }, require: name => {
    if (name === 'node:fs') return { readFileSync: (file, ...args) => {
      if (path.resolve(file) === releasePath && editRelease) {
        const value = editRelease(JSON.parse(fs.readFileSync(file)));
        return Buffer.from(JSON.stringify(value));
      }
      const value = fs.readFileSync(file, ...args);
      return editFile ? editFile(path.relative(root, file).replaceAll('\\', '/'), value) : value;
    }};
    if (name === './advisoryBundle' && editLoaded) return { loadAdvisoryBundle: () => editLoaded(realRequire(name).loadAdvisoryBundle()) };
    return realRequire(name);
  }};
  vm.runInNewContext(fs.readFileSync(entry, 'utf8'), context, { filename: entry });
  return context.module.exports;
}
function rehash(release) { const { runtimeIdentityHash, ...payload } = release; return { ...payload, runtimeIdentityHash: '0x' + sha(canonicalize(payload)) }; }
test('frozen request profile remains byte-identical and operational identity is distinct', () => {
  const api = require('../runtimeProtocol'), profile = api.loadHistoricalProtocolArtifact(), active = api.loadProtocolArtifact(), release = api.loadOperationalRelease();
  assert.equal(sha(fs.readFileSync(profilePath)), '3799e45de1e9be95aa728cb33308eab163b0b685a1542779a503a2c494a93ff9');
  assert.equal(profile.modelIdentityHash, '0xe722db3519fc3f2667c5ba1b8a18854b8a59357a925d37ecf38d5903ad9b6595');
  assert.deepEqual(release.compatibleModelIdentityHashes, [profile.legacyModelIdentityHash, profile.modelIdentityHash, active.modelIdentityHash]);
  assert.notEqual(active.modelIdentityHash, profile.modelIdentityHash);
  assert.equal(active.bundleHash, profile.bundleHash); assert.equal(active.thresholdUnits, profile.thresholdUnits);
  assert.notEqual(release.runtimeIdentityHash, profile.modelIdentityHash);
  assert.equal(api.resolveRequestModel(profile.modelIdentityHash).kind, 'xgboost');
  assert.equal(api.resolveRequestModel(profile.legacyModelIdentityHash).kind, 'legacy-nb');
  assert.throws(() => api.resolveRequestModel(release.runtimeIdentityHash), /Unsupported/);
});
for (const file of ['oracle/index.js', 'oracle/runtimeProtocol.js', 'oracle/scanRecovery.js', 'oracle/workerHealth.js', 'oracle/appealValidation.js', 'backEnd/artifacts/xgboost-protocol-v5.json',
  'oracle/protocolAssessment.js', 'oracle/protocol.js', 'oracle/recordIdentity.js', 'oracle/merkleProof.js', 'backEnd/artifacts/xgboost-protocol-v4.json']) {
  test('reject changed bytes: ' + file, () => {
    const api = isolated({ editFile: (name, bytes) => name === file ? Buffer.concat([Buffer.from(bytes), Buffer.from(' ')]) : bytes });
    assert.throws(() => api.loadProtocolArtifact(), /integrity mismatch/);
  });
}
for (const [name, edit] of [
  ['unknown release', r => rehash({ ...r, release: 'unapproved-release' })],
  ['different evaluator', r => rehash({ ...r, compatibleModelIdentityHashes: ['0x' + '1'.repeat(64)] })],
  ['missing protected file', r => { delete r.files['oracle/scanRecovery.js']; return rehash(r); }],
  ['arbitrary path', r => { r.files['../../outside'] = 'x'; return rehash(r); }],
  ['extra properties', r => rehash({ ...r, ignoreMismatch: true })],
  ['wrong runtime fingerprint', r => ({ ...r, runtimeIdentityHash: '0x' + '0'.repeat(64) })],
]) test('reject manifest: ' + name, () => assert.throws(() => isolated({ editRelease: edit }).loadProtocolArtifact(), /integrity mismatch/));
test('missing release never falls back to unchecked execution', () => {
  assert.throws(() => isolated({ editFile: (name, bytes) => { if (name.endsWith('oracle-runtime-compatibility-v2.json')) throw Error('missing release'); return bytes; } }).loadProtocolArtifact(), /missing release/);
});
test('modified inference identity or threshold cannot inherit compatibility', () => {
  for (const editLoaded of [v => ({ ...v, bundleHash: 'changed' }), v => ({ ...v, manifestHash: 'changed' }),
    v => ({ ...v, bundle: { ...v.bundle, policy: { ...v.bundle.policy, thresholdUnits: 1 } } })]) {
    assert.throws(() => isolated({ editLoaded }).loadProtocolArtifact(), /integrity mismatch/);
  }
});
