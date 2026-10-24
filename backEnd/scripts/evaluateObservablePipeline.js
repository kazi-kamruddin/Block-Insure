const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { buildHybridDataset } = require("./buildHybridDataset");
const { createDeterministicSampler } = require("../services/hybridDatasetAdapterService");
const { FEATURE_NAMES, extractObservableRecordFeatures, claimForRecord } = require("../services/featureEngineeringService");
const { trainModelParams } = require("../services/modelTrainingService");
const { freezeModelArtifact } = require("../services/modelArtifactService");
const { predictBernoulliNaiveBayes } = require("../services/bernoulliNaiveBayesService");
const { calibrateProbability, fitPlattScaling } = require("../services/calibrationService");
const { buildTriagePolicyPayload, freezeTriagePolicy } = require("../services/triagePolicyService");
const { buildConfusionMatrix, calculateClassificationMetrics, calculateCurves } = require("../services/evaluationMetricsService");
const { trainLogisticRegression, predictLogisticRegression } = require("../services/logisticRegressionService");
const { CONTINUOUS_FEATURES, continuousFeatures, fitStandardizer, standardize } = require("../services/continuousFeatureService");
const { compareCommittedRecord } = require("../../oracle/independentAssessment");
const { atomicWriteFileSync } = require("../services/researchArtifactService");
const root = path.resolve(__dirname, "../..");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const forEach = async (file, visit, expectedHash) => {
  const input = fs.createReadStream(file);
  const hash = crypto.createHash("sha256");
  input.on("data", (chunk) => hash.update(chunk));
  const reader = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of reader) if (line.trim()) visit(JSON.parse(line));
  if (expectedHash && hash.digest("hex") !== expectedHash) throw new Error(`Dataset checksum mismatch: ${path.basename(file)}`);
};
const write = (directory, name, value) => atomicWriteFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
const patient = (record) => record.patientHash;
const provider = (record) => record.hospitalId;
const label = (record) => Boolean(record.controlledAttackTruth);
const rows = (records) => records.map((record) => ({ actualFraud: label(record), features: extractObservableRecordFeatures(record) }));
const metrics = (predictions) => {
  const confusion = buildConfusionMatrix(predictions, (row) => row.fraudProbability >= 0.5);
  return { records: predictions.length, confusion, ...calculateClassificationMetrics(confusion), curves: calculateCurves(predictions) };
};

async function run({ outputRoot, datasetRoot, sampleSize = 4000 } = {}) {
  const sourceFiles = ["oracle/observableFeatures.js", "oracle/independentAssessment.js", "backEnd/services/featureEngineeringService.js", "backEnd/services/modelTrainingService.js", "backEnd/services/modelArtifactService.js", "backEnd/services/continuousFeatureService.js", "backEnd/services/logisticRegressionService.js", "backEnd/services/hybridDatasetAdapterService.js", "backEnd/scripts/buildHybridDataset.js", "backEnd/scripts/evaluateObservablePipeline.js"];
  const sourceSha256 = Object.fromEntries(sourceFiles.map((file) => [file, sha256(fs.readFileSync(path.join(root, file)))]));
  const directory = outputRoot || path.join(root, "docs/engineered", `observable-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  if (fs.existsSync(path.join(directory, "evaluation.json"))) throw new Error("Evaluation already exists; choose a new output directory");
  const dataDirectory = datasetRoot ? path.resolve(datasetRoot) : directory;
  console.log(datasetRoot ? "Reusing a versioned dataset; writing a separate new evaluation." : "Building a new versioned dataset; existing research/runtime files are untouched.");
  const manifest = datasetRoot ? JSON.parse(fs.readFileSync(path.join(dataDirectory, "manifest.json"), "utf8"))
    : await buildHybridDataset({ outputRoot: directory, observableScenarios: true });
  if (manifest.datasetVersion !== "blockinsure-hybrid-observable-v1") throw new Error("The observable experiment requires its versioned dataset, not historical rows");
  const seed = manifest.seed;
  const allTrainPatients = new Set(), allCalibrationPatients = new Set();
  const train = createDeterministicSampler(sampleSize, { seed, namespace: "observable-train" });
  const calibration = createDeterministicSampler(sampleSize, { seed, namespace: "observable-calibration" });
  const test = createDeterministicSampler(sampleSize, { seed, namespace: "observable-test" });
  const eligibility = { train: 0, calibration: 0, test: 0 };
  await forEach(path.join(dataDirectory, manifest.outputFiles.train), (record) => {
    allTrainPatients.add(patient(record)); eligibility.train++; train.consider(record.sourceClaimId, record);
  }, manifest.outputSha256.train);
  await forEach(path.join(dataDirectory, manifest.outputFiles.calibration), (record) => {
    allCalibrationPatients.add(patient(record));
    if (allTrainPatients.has(patient(record))) return;
    eligibility.calibration++; calibration.consider(record.sourceClaimId, record);
  }, manifest.outputSha256.calibration);
  await forEach(path.join(dataDirectory, manifest.outputFiles.testAttacks), (record) => {
    if (allTrainPatients.has(patient(record)) || allCalibrationPatients.has(patient(record))) return;
    eligibility.test++; test.consider(record.sourceClaimId, record);
  }, manifest.outputSha256.testAttacks);
  const training = train.values(), calibrationPool = calibration.values(), testing = test.values();
  // Fit probability calibration and choose operating points on distinct providers.
  const fitCalibration = calibrationPool.filter((record) => sha256(provider(record)).charCodeAt(0) % 2 === 0);
  const fittedPatients = new Set(fitCalibration.map(patient));
  const selectThreshold = calibrationPool.filter((record) => sha256(provider(record)).charCodeAt(0) % 2 !== 0 && !fittedPatients.has(patient(record)));
  if ([training, fitCalibration, selectThreshold, testing].some((partition) => partition.length < 50 || new Set(partition.map(label)).size < 2)) throw new Error("Insufficient held-out labels; no metrics or promotion produced");
  const gitCommit = execFileSync("git", ["-c", `safe.directory=${root.replace(/\\/g, "/")}`, "rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  console.log(`Training on ${training.length}, calibrating on ${fitCalibration.length}, selecting policy on ${selectThreshold.length}, testing on ${testing.length} rows.`);
  let model = trainModelParams(training, { modelVersion: "bernoulli-observable-hybrid-v1", source: "Existing Medicare source with controlled observable scenarios; not natural fraud ground truth", gitCommit });
  const predictRaw = (record) => predictBernoulliNaiveBayes(model, extractObservableRecordFeatures(record)).fraudProbability;
  const fitted = fitPlattScaling(fitCalibration.map((record) => ({ actualFraud: label(record), fraudProbability: predictRaw(record) })));
  model = freezeModelArtifact({ ...model, calibration: { ...fitted, records: fitCalibration.length }, calibrationDataHash: sha256(JSON.stringify(fitCalibration.map((record) => record.sourceClaimId))) });
  const probability = (record) => calibrateProbability(predictRaw(record), model.calibration);
  const policy = freezeTriagePolicy(buildTriagePolicyPayload({ modelArtifact: model,
    calibrationProbabilities: selectThreshold.map(probability), datasetManifestHash: sha256(JSON.stringify(manifest)) }));
  const rule = (record) => {
    const features = extractObservableRecordFeatures(record);
    const comparison = compareCommittedRecord({ record, claim: record.observedClaim || claimForRecord(record) });
    // Binding is a separate mandatory runtime prerequisite. Offline source rows
    // have no wallet and must not be described as accepted/authorized patients.
    return ["hospitalId", "invoiceHash", "billAmount", "recordStatus", "invoiceStatus", "licenseStatus"].some((name) => !comparison[name]) ||
      [...policy.routing.hardBlockingFeatures, ...policy.routing.manualReviewFeatures].some((name) => features[name]);
  };
  const binaryTrain = rows(training);
  const extendedNames = [...FEATURE_NAMES, ...CONTINUOUS_FEATURES];
  const extended = (record) => ({ ...extractObservableRecordFeatures(record), ...continuousFeatures(record) });
  const numericRows = training.map((record) => ({ actualFraud: label(record), features: extended(record) }));
  const normalization = fitStandardizer(numericRows, extendedNames);
  const logistic = trainLogisticRegression({ rows: numericRows.map((row) => ({ ...row, features: standardize(row.features, normalization) })),
    featureNames: extendedNames, inputEncoding: "continuous", iterations: 300 });
  const binaryLogistic = trainLogisticRegression({ rows: binaryTrain, featureNames: FEATURE_NAMES, iterations: 300 });
  // Thresholds are selected once on the policy partition, never on test outcomes.
  const chooseThreshold = (predict) => {
    const values = selectThreshold.map(predict).sort((a, b) => b - a);
    return values[Math.max(0, Math.floor(values.length * 0.2) - 1)];
  };
  const numericProbability = (record) => predictLogisticRegression(logistic, standardize(extended(record), normalization)).fraudProbability;
  const binaryProbability = (record) => predictLogisticRegression(binaryLogistic, extractObservableRecordFeatures(record)).fraudProbability;
  const numericThreshold = chooseThreshold(numericProbability), binaryThreshold = chooseThreshold(binaryProbability);
  const methods = {
    rules_only: rule,
    observable_nb_only: (record) => probability(record) >= policy.routing.manualReviewThreshold,
    observable_nb_plus_rules: (record) => rule(record) || probability(record) >= policy.routing.manualReviewThreshold,
    binary_logistic_plus_rules: (record) => rule(record) || binaryProbability(record) >= binaryThreshold,
    continuous_logistic_plus_rules: (record) => rule(record) || numericProbability(record) >= numericThreshold,
  };
  const scores = Object.fromEntries(Object.entries(methods).map(([name, decision]) => [name,
    metrics(testing.map((record) => ({ actualFraud: label(record), fraudProbability: Number(decision(record)) })))]));
  // PR/ROC areas on binary decisions are not probability-ranking evidence.
  for (const value of Object.values(scores)) delete value.curves;
  const probabilities = metrics(testing.map((record) => ({ actualFraud: label(record), fraudProbability: probability(record) })));
  const selectedIds = new Set(testing.map((record) => record.sourceClaimId));
  const original = new Map();
  await forEach(path.join(dataDirectory, manifest.outputFiles.testUntouched), (record) => { if (selectedIds.has(record.sourceClaimId)) original.set(record.sourceClaimId, record); }, manifest.outputSha256.testUntouched);
  const scenarios = {};
  for (const record of testing.filter(label)) {
    const group = scenarios[record.scenarioType] ||= { records: 0, unchangedObservableFeatures: 0, rulesRouted: 0, combinedRouted: 0 };
    group.records++;
    group.unchangedObservableFeatures += Number(JSON.stringify(extractObservableRecordFeatures(record)) === JSON.stringify(extractObservableRecordFeatures(original.get(record.sourceClaimId))));
    group.rulesRouted += Number(rule(record)); group.combinedRouted += Number(methods.observable_nb_plus_rules(record));
  }
  const partitions = [training, fitCalibration, selectThreshold, testing];
  const overlap = [];
  for (let left = 0; left < partitions.length; left++) for (let right = left + 1; right < partitions.length; right++) {
    const patients = new Set(partitions[left].map(patient)), providers = new Set(partitions[left].map(provider));
    const leaks = { left, right, sharedPatients: new Set(partitions[right].filter((record) => patients.has(patient(record))).map(patient)).size,
      sharedProviders: new Set(partitions[right].filter((record) => providers.has(provider(record))).map(provider)).size };
    if (leaks.sharedPatients || leaks.sharedProviders) throw new Error("Group overlap found; report withheld");
    overlap.push(leaks);
  }
  for (const [file, expected] of Object.entries(sourceSha256)) if (sha256(fs.readFileSync(path.join(root, file))) !== expected) throw new Error("Source changed during the experiment; keep the dataset and rerun evaluation into a new directory");
  const report = { reviewedAt: new Date().toISOString(), gitCommit, sourceSha256,
    scope: "New offline controlled-attack experiment, not natural fraud detection, not a deployed model, not a revision of the frozen paper results",
    data: { datasetDirectory: path.relative(root, dataDirectory).replaceAll("\\", "/"), manifestSha256: sha256(fs.readFileSync(path.join(dataDirectory, "manifest.json"))), sourceClaims: manifest.totalUniqueClaims, available: eligibility, sampled: partitions.map((partition) => partition.length), sampleSize, seed, overlap,
      selection: "Deterministic hash sample after excluding every earlier-partition patient; provider partitions inherited from the source builder; prior histories strictly earlier; no temporal-generalization claim",
      caveat: "Purging shared patients changes the target population. Untouched means unmutated, not verified legitimate. No runtime wallet authorization is inferred." },
    modelIdentityHash: model.modelIdentityHash, policyIdentityHash: policy.policyIdentityHash,
    methods: scores, probabilityMetrics: probabilities, scenarios,
    logisticThresholds: { binary: binaryThreshold, continuous: numericThreshold },
    limitations: ["Single deterministic sample/seed, no population significance claim", "Controlled labels are generated scenarios, not independently adjudicated fraud", "No observable signal is invented for concealed compromise or advisory-only duplicates", "Advanced GBDT/OOD/graph/SHAP/conformal methods are not deployed or claimed by this baseline ladder", "The active runtime model/policy and historical evidence are unchanged"] };
  write(directory, "model-params.staged.json", model); write(directory, "triage-policy.staged.json", policy);
  write(directory, "logistic-baselines.json", { binaryLogistic, continuousLogistic: logistic, normalization });
  write(directory, "evaluation.json", report);
  console.log(JSON.stringify({ output: path.relative(root, directory), methods: scores, scenarios }, null, 2));
  return { directory, report };
}
if (require.main === module) run().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
