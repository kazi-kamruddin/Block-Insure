// Read-only by default; --record writes only the small dated verification summary.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
function verify(directory, { snapshot } = {}) {
  directory = path.resolve(directory);
  assert(directory.startsWith(path.join(root, 'docs/engineered') + path.sep), 'Study must be inside ignored engineered directory');
  const inputDirectory = path.dirname(directory), manifest = read(path.join(inputDirectory, 'input-manifest.json'));
  const record = read(path.join(directory, 'prospective-record.json')), summary = read(path.join(directory, 'study-summary.json'));
  assert(record.inputManifestSha256 === hash(path.join(inputDirectory, 'input-manifest.json')), 'Input manifest changed');
  for (const [file, expected] of Object.entries(manifest.files)) assert(hash(path.join(inputDirectory, file)) === expected, `Input changed: ${file}`);
  const archivedFiles = [];
  const verifySource = (file, expected) => {
    if (hash(path.join(root, file)) === expected) return;
    const candidate = snapshot && file.startsWith('backEnd/research/') ? path.join(path.resolve(snapshot), path.basename(file)) : null;
    assert(candidate && fs.existsSync(candidate) && hash(candidate) === expected, `Source changed: ${file}; older studies need their explicit archived source, not current-code verification`);
    archivedFiles.push(file);
  };
  for (const [file, expected] of Object.entries(manifest.sourceFiles)) verifySource(file, expected);
  for (const [file, expected] of Object.entries(record.sourceSha256)) verifySource(`backEnd/research/${file}`, expected);
  assert(summary.promotion === 'HOLD', 'Phase 1/2 must not authorize runtime promotion');
  const evaluations = summary.seeds.map((seed) => {
    const base = path.join(directory, String(seed));
    const pipeline = read(path.join(base, 'pipeline.json')), receipt = read(path.join(base, 'receipt.json'));
    assert(receipt.pipelineSha256 === hash(path.join(base, 'pipeline.json')), 'Pipeline receipt mismatch');
    assert(pipeline.modelSha256 === hash(path.join(base, 'model.xgb.json')), 'Model hash mismatch');
    assert(pipeline.referenceSha256 === hash(path.join(base, 'trees.reference.json')), 'Portable reference hash mismatch');
    assert(pipeline.authority === 'OFFLINE_ONLY', 'Wrong candidate authority');
    const evaluation = read(path.join(directory, `${seed}-evaluation.json`));
    assert(evaluation.parity.referenceMaxProbabilityError < 1e-6 && evaluation.parity.referenceRoutingDifferences === 0, 'Exact export parity failed');
    assert(evaluation.parity.shapRawMarginMaxAdditivityError < 1e-4, 'SHAP consistency failed');
    assert(evaluation.parity.packagedPreprocessingRowsExactlyMatched === evaluation.parity.rows, 'Packaged preprocessing parity failed');
    return { seed, pipelineSha256: receipt.pipelineSha256, modelSha256: pipeline.modelSha256,
      metrics: evaluation.methods.gbdt_full.routing, parity: evaluation.parity,
      conformal: evaluation.methods.gbdt_full.conformal, pairedUncertainty: evaluation.pairedUncertainty };
  });
  const candidateFiles = Object.keys(record.sourceSha256).map((file) => `backEnd/research/${file}`);
  const sourceFiles = [...new Set([...Object.keys(manifest.sourceFiles), ...candidateFiles, 'backEnd/scripts/runAdvancedStudy.js', 'scripts/verifyAdvancedStudy.js'])];
  return { reviewedAt: new Date().toISOString(), reviewDateDhaka: '24 October 2026',
    baseCommit: execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    studyDirectory: path.relative(root, directory).replaceAll('\\', '/'),
    scope: 'Offline Phase 1/2 candidate construction and exploratory testing; not runtime, public-network, browser, mailbox or natural-fraud verification',
    historicalSourceSnapshot: snapshot ? { directory: path.relative(root, path.resolve(snapshot)).replaceAll('\\', '/'), usedFiles: [...new Set(archivedFiles)], currentSourceVerified: archivedFiles.length === 0 } : null,
    sourceSha256: Object.fromEntries(sourceFiles.map((file) => [file, hash(path.join(root, file))])),
    inputManifestSha256: hash(path.join(inputDirectory, 'input-manifest.json')), summarySha256: hash(path.join(directory, 'study-summary.json')),
    plan: record.plan, environment: record.environment, testRows: summary.testRows,
    meanRouting: summary.meanRouting, evaluations, promotion: summary.promotion,
    promotionChecks: summary.promotionChecks, limitations: summary.limitations,
    baselineUnchanged: { model: hash(path.join(root, 'backEnd/model-params.json')) === manifest.sourceFiles['backEnd/model-params.json'], policy: hash(path.join(root, 'backEnd/triage-policy.json')) === manifest.sourceFiles['backEnd/triage-policy.json'] },
    pilotEvidence: 'Two earlier exploratory study directories retained under advanced-2026-10-24-phase12; ablation OOD refit and context order checks corrected before the final end-to-end command. Pilots are not independent replications.' };
}
if (require.main === module) {
  try {
    const snapshotIndex = process.argv.indexOf('--snapshot');
    const report = verify(process.argv[2], { snapshot: snapshotIndex >= 0 ? process.argv[snapshotIndex + 1] : undefined });
    if (process.argv.includes('--record')) {
      const target = path.join(root, 'verification-results/advanced-ml-phase12-2026-10-24.json');
      assert(!fs.existsSync(target), 'Do not overwrite dated evidence; use a new verification filename');
      fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    }
    console.log(JSON.stringify({ sourceFilesChecked: Object.keys(report.sourceSha256).length, testRows: report.testRows, promotion: report.promotion, baselineUnchanged: report.baselineUnchanged, historicalSourceSnapshot: report.historicalSourceSnapshot }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { verify };
