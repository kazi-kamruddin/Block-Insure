const fs = require("node:fs");
const path = require("node:path");
const { generateSyntheticDataset } = require("../services/syntheticRegistryService");
const { predictBernoulliNaiveBayes } = require("../services/bernoulliNaiveBayesService");
const { calibrateProbability } = require("../services/calibrationService");
const { extractRecordFeatures } = require("../services/featureEngineeringService");
const {
  buildTriagePolicyPayload,
  freezeTriagePolicy,
  hasHardBlockingFeatures,
  verifyTriagePolicy,
} = require("../services/triagePolicyService");
const modelArtifact = require("../model-params.json");

const OUTPUT_PATH = path.join(__dirname, "..", "triage-policy.json");
const DATASET_MANIFEST_PATH = path.join(__dirname, "..", "datasets", "phase5", "manifest.json");

const run = ({ writeOutput = true } = {}) => {
  const records = generateSyntheticDataset({ profile: "normal", seed: 202605, size: 600 })
    .sort((left, right) => new Date(left.occurredAt) - new Date(right.occurredAt));
  const calibrationRecords = records.slice(Math.floor(records.length * 0.8));
  const calibrationProbabilities = calibrationRecords.filter((record) =>
    !hasHardBlockingFeatures(extractRecordFeatures(record))
  ).map((record) => {
    const raw = predictBernoulliNaiveBayes(modelArtifact, extractRecordFeatures(record));
    return calibrateProbability(raw.fraudProbability, modelArtifact.calibration);
  });
  const datasetManifest = JSON.parse(fs.readFileSync(DATASET_MANIFEST_PATH, "utf8"));
  const policy = freezeTriagePolicy(buildTriagePolicyPayload({
    modelArtifact,
    calibrationProbabilities,
    capacityRate: 0.2,
    datasetManifestHash: datasetManifest.manifestHash,
  }));
  const verification = verifyTriagePolicy(policy);
  if (!verification.valid) throw new Error(verification.errors.join("; "));
  if (writeOutput) {
    fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
  }
  return policy;
};

if (require.main === module) {
  const policy = run();
  console.log(`Frozen triage policy: ${OUTPUT_PATH}`);
  console.log(`Policy identity: ${policy.policyIdentityHash}`);
}

module.exports = { run };
