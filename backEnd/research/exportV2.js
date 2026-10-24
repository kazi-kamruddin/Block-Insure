// Reconstruct unmodified observables from the SAME raw source; never undo
// earlier attacks heuristically and never read provider-fraud labels for truth.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), readline = require('node:readline');
const { buildBaseHybridRecord, getProviderSplit, createDeterministicSampler, parseCsvLine, toRow } = require('../services/hybridDatasetAdapterService');
const { inspectFile } = require('../services/hybridDatasetIntegrityService');
const { extractObservedFeatures } = require('../../oracle/observableFeatures');
const { compareCommittedRecord } = require('../../oracle/independentAssessment');
const { continuousFeatures } = require('../services/continuousFeatureService');
const { createContextIndex } = require('./context');
const { engineer } = require('./scenariosV2');
const root = path.resolve(__dirname, '../..');
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');
const parts = ['train', 'tune', 'probability', 'conformal', 'policy', 'test'];
async function csv(file, visit) {
  const reader = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity }); let headers;
  for await (const line of reader) {
    if (!headers) { headers = parseCsvLine(line); continue; }
    if (line.trim()) visit(toRow(headers, parseCsvLine(line)));
  }
}
function prepareRecord(base, context, scenario) {
  const { record, claim, events } = scenario.observable;
  const prior = context.query(record, events);
  // Recompute trusted history instead of keeping mutable pre-engineered flags.
  record.observableHistory = {};
  const comparison = compareCommittedRecord({ record, claim });
  const binary = extractObservedFeatures({ record, comparison });
  const policy = require('../triage-policy.json');
  const mandatory = ['hospitalId', 'invoiceHash', 'billAmount', 'recordStatus', 'invoiceStatus', 'licenseStatus'].some((key) => !comparison[key]) || [...policy.routing.hardBlockingFeatures, ...policy.routing.manualReviewFeatures].some((key) => binary[key]);
  const result = { id: hash(base.sourceClaimId), patient: hash(base.patientHash), provider: hash(base.hospitalId),
    target: scenario.truth.intentionalIntervention, scenario: scenario.truth.family, mandatory,
    group: record.treatmentType, diagnosis: record.diagnosisCode || '',
    features: { ...Object.fromEntries(Object.entries(binary).map(([key, value]) => [key, Number(value)])), ...continuousFeatures(record), ...prior.features }, providerLags: prior.providerLags };
  return result;
}
async function run(output) {
  output = path.resolve(output);
  if (path.dirname(output) !== path.join(root, 'docs/engineered') || !path.basename(output).startsWith('advanced-') || fs.existsSync(output)) throw new Error('Use new docs/engineered/advanced-* output');
  const planBytes = fs.readFileSync(path.join(__dirname, 'engineering-plan-v2.json')), plan = JSON.parse(planBytes);
  const baseline = JSON.parse(fs.readFileSync(path.join(root, 'docs/engineered/observable-2026-10-23T19-34-11-717Z/manifest.json')));
  const raw = path.join(root, 'backEnd/datasets/hybrid-v1/raw');
  const sources = [['Train_Inpatientdata-1542865627584.csv', 'INPATIENT'], ['Train_Outpatientdata-1542865627584.csv', 'OUTPATIENT']];
  const rawHashes = {};
  for (const [file] of sources) {
    const checked = await inspectFile(path.join(raw, file));
    if (checked.sha256 !== baseline.sourceFiles[file].sha256) throw new Error('Raw source hash mismatch');
    rawHashes[file] = checked.sha256;
  }
  fs.mkdirSync(output); fs.writeFileSync(path.join(output, 'plan.json'), planBytes, { flag: 'wx' });
  const group = (provider) => {
    const parent = getProviderSplit(provider, baseline.seed);
    return parent === 'train' ? 0 : parent === 'test' ? 5 : 1 + parseInt(hash(`v2-calibration:${provider}`).slice(0, 8), 16) % 4;
  };
  const patientGroup = new Map(); let rawCount = 0;
  console.log('Engineering v2: assigning complete-source patient/provider groups');
  for (const [file] of sources) await csv(path.join(raw, file), (row) => {
    const g = group(row.Provider); patientGroup.set(row.BeneID, Math.min(patientGroup.get(row.BeneID) ?? 6, g)); rawCount++;
  });
  const counts = {}, traces = [], pairDiagnostics = [];
  for (let g = 0; g < parts.length; g++) {
    console.log(`Engineering v2: reconstructing pristine ${parts[g]} source/context`);
    const context = createContextIndex();
    const samples = plan.seeds.map((seed) => createDeterministicSampler(g === 0 || g === 5 ? plan.sampleSize : plan.calibrationGroupSize, { seed, namespace: `engineering-v2-${parts[g]}` }));
    let eligible = 0;
    for (const [file, setting] of sources) await csv(path.join(raw, file), (claim) => {
      if (group(claim.Provider) !== g || patientGroup.get(claim.BeneID) !== g) return;
      const base = buildBaseHybridRecord({ claim, claimSetting: setting, amountRange: baseline.amountRangesUsd[setting] });
      // Keep no labels, private demographics, scenario markers or raw IDs in history.
      const record = Object.fromEntries(['sourceClaimId', 'patientHash', 'hospitalId', 'diagnosisCode', 'treatmentType', 'admissionDate', 'dischargeDate', 'invoiceDate', 'billAmount', 'expectedBillMin', 'expectedBillMax', 'invoiceNumber', 'invoiceHash', 'invoiceStatus', 'recordStatus', 'licenseStatus'].map((key) => [key, base[key]]));
      // End-of-care/invoice date is the declared billing-availability proxy.
      // Never expose a completed bill merely because admission happened earlier.
      record.observationDate = record.invoiceDate;
      context.add(record); eligible++;
      for (const sampler of samples) sampler.consider(record.sourceClaimId, record);
    });
    context.seal(); counts[parts[g]] = { eligible };
    if (g === 0) fs.writeFileSync(path.join(output, 'training-series.json'), JSON.stringify(context.series()), { flag: 'wx' });
    const cohorts = g === 5 ? ['test', 'test_prevalence', 'test_severity', 'test_family'] : [parts[g]];
    for (let index = 0; index < plan.seeds.length; index++) {
      const seed = plan.seeds[index], anchors = samples[index].values();
      for (const cohort of cohorts) {
        const rows = anchors.map((base) => {
          const scenario = engineer(base, { seed, rate: cohort === 'test_prevalence' ? plan.stressAttackRate : plan.attackRate, plan, cohort });
          const row = prepareRecord(base, context, scenario);
          traces.push({ seed, cohort, anchorHash: row.id, truth: { ...scenario.truth, sourceClaimId: undefined },
            changedFields: Object.keys(scenario.observable.record).filter((key) => JSON.stringify(base[key]) !== JSON.stringify(scenario.observable.record[key]) && key !== 'observableHistory'),
            additionalPriorEvents: scenario.observable.events.length,
            sourceKind: 'Reconstructed raw-source anchor + explicitly simulated action; no natural-fraud truth' });
          return row;
        });
        fs.writeFileSync(path.join(output, `${seed}-${cohort}.json`), JSON.stringify(rows), { flag: 'wx' });
        counts[`${seed}-${cohort}`] = { rows: rows.length, positives: rows.filter((r) => r.target).length,
          families: Object.fromEntries([...new Set(rows.map((r) => r.scenario))].sort().map((family) => [family, rows.filter((r) => r.scenario === family).length])) };
      }
      if (g === 5) {
        const paired = [];
        for (const base of anchors.slice(0, 100)) {
          for (const [attack, benign] of [['COHERENT_BILL_INFLATION', 'BENIGN_HIGH_COST'], ['REPEATED_SERVICE_BILLING', 'BENIGN_REPEAT_CARE'], ['COORDINATED_BILLING_BURST', 'BENIGN_PROVIDER_SURGE'], ['CONCEALED_PHANTOM_BILLING', 'UNCHANGED_CONTROL']]) {
            const a = prepareRecord(base, context, engineer(base, { seed, rate: 1, plan, forcedFamily: attack, forcedSeverity: 1.5 }));
            const b = prepareRecord(base, context, engineer(base, { seed, rate: 0, plan, forcedFamily: benign, forcedSeverity: 1.5 }));
            if (JSON.stringify(a.features) !== JSON.stringify(b.features) || JSON.stringify(a.providerLags) !== JSON.stringify(b.providerLags)) throw new Error('Intent-only twins accidentally expose the answer key');
            paired.push({ ...a, pairRole: 'intentional', pairFamily: attack }, { ...b, pairRole: 'benign', pairFamily: attack });
          }
        }
        fs.writeFileSync(path.join(output, `${seed}-intent-pairs.json`), JSON.stringify(paired), { flag: 'wx' });
        pairDiagnostics.push({ seed, pairs: paired.length / 2, identicalInputsWithOppositeIntent: paired.length / 2 });
      }
    }
  }
  fs.writeFileSync(path.join(output, 'engineering-trace.jsonl'), traces.map((row) => JSON.stringify(row)).join('\n') + '\n', { flag: 'wx' });
  const sourceFiles = ['backEnd/model-params.json', 'backEnd/triage-policy.json', 'backEnd/services/hybridDatasetAdapterService.js', 'oracle/observableFeatures.js', 'oracle/independentAssessment.js', 'backEnd/services/continuousFeatureService.js', 'backEnd/research/context.js', 'backEnd/research/scenariosV2.js', 'backEnd/research/exportV2.js', 'backEnd/research/engineering-plan-v2.json'];
  // Recheck raw bytes after reconstruction, not just at entry.
  for (const [file, expected] of Object.entries(rawHashes)) if ((await inspectFile(path.join(raw, file))).sha256 !== expected) throw new Error('Raw input changed');
  const files = Object.fromEntries(fs.readdirSync(output).map((name) => [name, hash(fs.readFileSync(path.join(output, name)))]));
  fs.writeFileSync(path.join(output, 'input-manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), schema: 'source-grounded-actions-v2', rawCount, sourceHashes: rawHashes,
    historicalRangeReference: 'Previously frozen training-only ranges; not diagnosis-normal costs', planHash: hash(planBytes), files, counts, pairDiagnostics,
    sourceFiles: Object.fromEntries(sourceFiles.map((file) => [file, hash(fs.readFileSync(path.join(root, file)))])),
    caveats: ['Same raw Medicare benchmark, reconstructed from raw; no second dataset', 'No supervised label from provider PotentialFraud', 'Fraud intent is simulator metadata; some opposite-intent observations are deliberately indistinguishable', 'New simulations are designed after old results; exploratory not confirmatory', 'No runtime import, schema migration or database write'] }, null, 2), { flag: 'wx' });
  console.log(`Engineering v2 export complete: ${output}`);
}
if (require.main === module) run(process.argv[2]).catch((error) => { console.error(error.stack); process.exitCode = 1; });
module.exports = { run, prepareRecord, csv };
