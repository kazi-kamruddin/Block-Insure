const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { generateSyntheticDataset } = require("../services/syntheticRegistryService");
const { trainModelParams } = require("../services/modelTrainingService");
const { verifyModelArtifact } = require("../services/modelArtifactService");
const { predictBernoulliNaiveBayes } = require("../services/bernoulliNaiveBayesService");
const { extractRecordFeatures } = require("../services/featureEngineeringService");
const { fitPlattScaling } = require("../services/calibrationService");
const { calculateTrainingDataHash } = require("../services/modelArtifactService");

const OUTPUT_PATH = path.join(__dirname, "..", "model-params.json");
const REPOSITORY_ROOT = path.join(__dirname, "..", "..");

const resolveSourceCommit = () => {
  const explicitCommit = process.env.GIT_COMMIT?.trim();
  const commit =
    explicitCommit ||
    execFileSync(
      "git",
      [
        "-c",
        `safe.directory=${REPOSITORY_ROOT.replace(/\\/g, "/")}`,
        "rev-parse",
        "HEAD",
      ],
      {
        cwd: REPOSITORY_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      }
    ).trim();

  if (!/^[0-9a-f]{40}$/i.test(commit)) {
    throw new Error("GIT_COMMIT must be a full 40-character Git commit hash");
  }
  return commit.toLowerCase();
};

const run = ({ writeOutput = true } = {}) => {
  const records = generateSyntheticDataset({ profile: "normal", seed: 202605, size: 600 });
  const ordered = records.slice().sort(
    (left, right) => new Date(left.occurredAt) - new Date(right.occurredAt)
  );
  const split = Math.floor(ordered.length * 0.8);
  const trainingRecords = ordered.slice(0, split);
  const calibrationRecords = ordered.slice(split);
  const uncalibratedModel = trainModelParams(trainingRecords, {
    modelVersion: "bernoulli-fraud-v3.0.0-calibration-fit",
    trainedAt: "2026-08-15T00:00:00.000Z",
  });
  const calibrationRows = calibrationRecords.map((record) => ({
    actualFraud: record.actualFraud,
    fraudProbability: predictBernoulliNaiveBayes(
      uncalibratedModel,
      extractRecordFeatures(record)
    ).fraudProbability,
  }));
  const calibration = {
    ...fitPlattScaling(calibrationRows),
    trainedOn: "latest 20 percent temporal validation partition",
    records: calibrationRows.length,
  };
  const artifact = trainModelParams(trainingRecords, {
    modelVersion: "bernoulli-fraud-v3.0.0",
    trainedAt: "2026-08-15T00:00:00.000Z",
    source: "phase5/normal seed=202605 size=600",
    gitCommit: resolveSourceCommit(),
    threshold: 0.5,
    calibration,
    calibrationDataHash: calculateTrainingDataHash(
      calibrationRecords.map((record) => ({
        ...record,
        features: extractRecordFeatures(record),
      }))
    ),
  });
  const verification = verifyModelArtifact(artifact);
  if (!verification.valid) throw new Error(verification.errors.join("; "));
  if (writeOutput) fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifact;
};

if (require.main === module) {
  const artifact = run();
  console.log(`Frozen model artifact: ${OUTPUT_PATH}`);
  console.log(`Artifact hash: ${artifact.artifactHash}`);
  console.log(`On-chain model identity: ${artifact.modelIdentityHash}`);
}

module.exports = { run };
