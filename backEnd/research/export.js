const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { forEach } = require('../scripts/evaluateObservablePipeline');
const { createDeterministicSampler } = require('../services/hybridDatasetAdapterService');
const { extractObservableRecordFeatures, claimForRecord, FEATURE_NAMES } = require('../services/featureEngineeringService');
const { continuousFeatures } = require('../services/continuousFeatureService');
const { compareCommittedRecord } = require('../../oracle/independentAssessment');
const { createContextIndex } = require('./context');
const policy = require('../triage-policy.json');
const root = path.resolve(__dirname, '../..');
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');
async function run(output, dataset = process.env.OBSERVABLE_DATASET_DIR || path.join(root, 'docs/engineered/observable-2026-10-23T19-34-11-717Z')) {
  output = path.resolve(output); dataset = path.resolve(dataset);
  const allowed = path.join(root, 'docs/engineered');
  if (!output.startsWith(allowed + path.sep) || !path.basename(output).startsWith('advanced-') || fs.existsSync(output)) throw new Error('Use a new docs/engineered/advanced-* directory');
  const planBytes = fs.readFileSync(path.join(__dirname, 'advanced-plan.json')), plan = JSON.parse(planBytes);
  const manifestBytes = fs.readFileSync(path.join(dataset, 'manifest.json')), manifest = JSON.parse(manifestBytes);
  if (manifest.datasetVersion !== 'blockinsure-hybrid-observable-v1') throw new Error('Wrong source version');
  fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'plan.json'), planBytes, { flag: 'wx' });
  const parents = ['train', 'calibration', 'testAttacks'];
  const allPatients = parents.map(() => new Set());
  const samplers = plan.seeds.map((seed) => parents.map((name) => createDeterministicSampler(plan.sampleSize, { seed, namespace: `advanced-${name}` })));
  const calibrationGroup = (id) => parseInt(hash(String(id)).slice(0, 8), 16) % 4;
  const earlierCalPatients = [new Set(), new Set(), new Set(), new Set()];
  const stream = (name, fn) => forEach(path.join(dataset, manifest.outputFiles[name]), fn, manifest.outputSha256[name]);
  for (let index = 0; index < parents.length; index++) {
    console.log(`Scanning and checking ${parents[index]}`);
    await stream(parents[index], (record) => {
      allPatients[index].add(record.patientHash);
      if (allPatients.slice(0, index).some((set) => set.has(record.patientHash))) return;
      if (index === 1) earlierCalPatients[calibrationGroup(record.hospitalId)].add(record.patientHash);
      for (const set of samplers) set[index].consider(record.sourceClaimId, record);
    });
  }
  const experiments = samplers.map((set) => {
    const groups = { train: set[0].values(), tune: [], probability: [], conformal: [], policy: [], test: set[2].values() };
    for (const record of set[1].values()) { const g = calibrationGroup(record.hospitalId); if (earlierCalPatients.slice(0, g).some((s) => s.has(record.patientHash))) continue; groups[['tune', 'probability', 'conformal', 'policy'][g]].push(record); }
    const values = Object.entries(groups);
    for (let a = 0; a < values.length; a++) for (let b = a + 1; b < values.length; b++) {
      for (const key of ['patientHash', 'hospitalId']) { const ids = new Set(values[a][1].map((r) => r[key])); if (values[b][1].some((r) => ids.has(r[key]))) throw new Error('Partition overlap'); }
    }
    if (values.some(([, rows]) => rows.length < 60 || new Set(rows.map((r) => Boolean(r.controlledAttackTruth))).size !== 2)) throw new Error('Insufficient isolated labels');
    return groups;
  });
  for (const [part, parent, groupNumber] of [['train', 'train', -1], ['tune', 'calibration', 0], ['probability', 'calibration', 1], ['conformal', 'calibration', 2], ['policy', 'calibration', 3], ['test', 'testUntouched', -1]]) {
    console.log(`Building strictly-prior context: ${part}`);
    const context = createContextIndex();
    await stream(parent, (record) => {
      const index = parent === 'train' ? 0 : parent === 'calibration' ? 1 : 2;
      if (allPatients.slice(0, index).some((set) => set.has(record.patientHash))) return;
      if (index === 1 && (calibrationGroup(record.hospitalId) !== groupNumber || earlierCalPatients.slice(0, groupNumber).some((set) => set.has(record.patientHash)))) return;
      context.add(record);
    });
    context.seal();
    if (part === 'train') fs.writeFileSync(path.join(output, 'training-series.json'), JSON.stringify(context.series()), { flag: 'wx' });
    for (let i = 0; i < experiments.length; i++) {
      const rows = experiments[i][part].map((record) => {
        const binary = extractObservableRecordFeatures(record), comparison = compareCommittedRecord({ record, claim: record.observedClaim || claimForRecord(record) });
        const mandatory = ['hospitalId', 'invoiceHash', 'billAmount', 'recordStatus', 'invoiceStatus', 'licenseStatus'].some((key) => !comparison[key]) || [...policy.routing.hardBlockingFeatures, ...policy.routing.manualReviewFeatures].some((key) => binary[key]);
        const prior = context.query(record);
        return { id: hash(record.sourceClaimId), patient: hash(record.patientHash), provider: hash(record.hospitalId),
          target: Boolean(record.controlledAttackTruth), scenario: record.scenarioType || 'UNMUTATED', mandatory,
          group: record.treatmentType || 'UNKNOWN', diagnosis: record.diagnosisCode || '',
          features: { ...Object.fromEntries(FEATURE_NAMES.map((key) => [key, Number(binary[key])])), ...continuousFeatures(record), ...prior.features }, providerLags: prior.providerLags };
      });
      fs.writeFileSync(path.join(output, `${plan.seeds[i]}-${part}.json`), JSON.stringify(rows), { flag: 'wx' });
    }
  }
  const sourceFiles = ['backEnd/model-params.json', 'backEnd/triage-policy.json', 'oracle/observableFeatures.js', 'backEnd/services/featureEngineeringService.js', 'backEnd/services/continuousFeatureService.js', 'backEnd/services/hybridDatasetAdapterService.js', 'backEnd/scripts/buildHybridDataset.js', 'backEnd/research/context.js', 'backEnd/research/export.js', 'backEnd/research/advanced-plan.json'];
  const files = Object.fromEntries(fs.readdirSync(output).map((name) => [name, hash(fs.readFileSync(path.join(output, name)))]));
  fs.writeFileSync(path.join(output, 'input-manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), manifestHash: hash(manifestBytes), sourceDirectory: path.relative(root, dataset), sourceHashes: manifest.outputSha256,
    planHash: hash(planBytes), files, sourceFiles: Object.fromEntries(sourceFiles.map((name) => [name, hash(fs.readFileSync(path.join(root, name)))])),
    caveats: ['Exploratory reused source/scenario partition', 'No real bank graph', 'Training/calibration historical records include observable earlier mutations; no targets/markers used', 'Test history uses unmutated source, not future test outcomes', 'All contexts are group-local and exclude equal/future dates', 'Source dates and reference ranges are engineered benchmark fields; not verified clinical norms'] }, null, 2), { flag: 'wx' });
  console.log(`Export complete: ${output}`);
}
if (require.main === module) run(process.argv[2]).catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
