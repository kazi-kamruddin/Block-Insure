const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
function verify(directory) {
  directory = path.resolve(directory);
  assert(directory.startsWith(path.join(root, 'docs/engineered') + path.sep), 'Use an engineered study directory');
  const input = path.dirname(directory), manifest = read(path.join(input, 'input-manifest.json')), record = read(path.join(directory, 'prospective-record.json')), summary = read(path.join(directory, 'study-summary.json'));
  assert(manifest.schema === 'source-grounded-actions-v2' && summary.promotion === 'HOLD', 'Wrong engineering/authority boundary');
  assert(record.inputManifestSha256 === hash(path.join(input, 'input-manifest.json')), 'Input manifest mismatch');
  for (const [file, expected] of Object.entries(manifest.files)) assert(hash(path.join(input, file)) === expected, `Data changed: ${file}`);
  for (const [file, expected] of Object.entries(manifest.sourceFiles)) assert(hash(path.join(root, file)) === expected, `Engineering source changed: ${file}`);
  for (const [file, expected] of Object.entries(record.sourceSha256)) assert(hash(path.join(root, 'backEnd/research', file)) === expected, `Candidate source changed: ${file}`);
  const results = summary.seeds.map((seed) => {
    const base = path.join(directory, String(seed)), pipeline = read(path.join(base, 'pipeline.json')), receipt = read(path.join(base, 'receipt.json'));
    assert(hash(path.join(base, 'pipeline.json')) === receipt.pipelineSha256 && hash(path.join(base, 'model.xgb.json')) === pipeline.modelSha256, 'Artifact identity mismatch');
    const evaluation = read(path.join(directory, `${seed}-evaluation.json`)), challenge = read(path.join(directory, `${seed}-challenge-evaluation.json`));
    assert(evaluation.parity.referenceRoutingDifferences === 0 && evaluation.parity.packagedPreprocessingRowsExactlyMatched === evaluation.parity.rows, 'Exact prediction/preprocessing parity failed');
    assert(challenge.intentTwins.maxScoreDifference === 0, 'Opposite-intent input leak');
    assert(pipeline.conformal.quantile.method === 'label_conditional', 'Wrong conformal method');
    return { seed, pipelineSha256: receipt.pipelineSha256, modelSha256: pipeline.modelSha256, primary: evaluation.methods.gbdt_full,
      cohortCoverage: Object.fromEntries(['test', 'test_prevalence', 'test_severity', 'test_family'].map((name) => [name, challenge[name].conformal])),
      intentTwins: challenge.intentTwins, parity: evaluation.parity };
  });
  const auditFile = path.join(directory, 'posthoc-calibration-audit.json');
  const audit = fs.existsSync(auditFile) ? read(auditFile) : null;
  if (audit) {
    assert(audit.studySummarySha256 === hash(path.join(directory, 'study-summary.json')), 'Posthoc audit refers to a different study');
    assert(audit.sourceSha256 === hash(path.join(root, 'backEnd/research/auditV2.py')), 'Posthoc audit source changed');
  }
  const files = [...new Set([...Object.keys(manifest.sourceFiles), ...Object.keys(record.sourceSha256).map((name) => `backEnd/research/${name}`), 'backEnd/scripts/runEngineeredStudy.js', 'scripts/verifyEngineeredStudy.js', ...(audit ? ['backEnd/research/auditV2.py'] : [])])];
  return { reviewedAt: new Date().toISOString(), scope: 'Exploratory simulator-action benchmark, not natural-fraud or runtime validation',
    studyDirectory: path.relative(root, directory).replaceAll('\\', '/'), sourceSha256: Object.fromEntries(files.map((name) => [name, hash(path.join(root, name))])),
    inputManifestSha256: hash(path.join(input, 'input-manifest.json')), summarySha256: hash(path.join(directory, 'study-summary.json')),
    plan: record.plan, rawSourceHashes: manifest.sourceHashes, rows: summary.testRows, sourceCount: manifest.rawCount,
    meanRouting: summary.meanRouting, cohorts: summary.cohorts, temporalFit: summary.temporalFit, results,
    baselineUnchanged: { model: hash(path.join(root, 'backEnd/model-params.json')) === manifest.sourceFiles['backEnd/model-params.json'], policy: hash(path.join(root, 'backEnd/triage-policy.json')) === manifest.sourceFiles['backEnd/triage-policy.json'] },
    posthocCalibrationAudit: audit ? { sha256: hash(auditFile), scope: audit.scope, meanCoverage: audit.meanCoverage } : null,
    promotion: 'HOLD', limitations: summary.limitations };
}
if (require.main === module) {
  try {
    const result = verify(process.argv[2]);
    if (process.argv.includes('--record')) fs.writeFileSync(path.join(root, 'verification-results/advanced-engineering-v2-2026-10-24.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ rows: result.rows, sourceCount: result.sourceCount, promotion: result.promotion, baselineUnchanged: result.baselineUnchanged, cohorts: result.cohorts }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { verify };
