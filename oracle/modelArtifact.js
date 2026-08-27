const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const canonicalize = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const loadAndVerifyModelArtifact = (filePath = path.join(__dirname, "..", "backEnd", "model-params.json")) => {
  const artifact = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const { artifactHash, modelIdentityHash, ...payload } = artifact;
  const expectedArtifactHash = sha256(canonicalize(payload));
  const identity = {
    modelVersion: artifact.modelVersion,
    trainingDataHash: artifact.trainingDataHash,
    featureSchemaVersion: artifact.featureSchemaVersion,
    threshold: artifact.threshold,
    calibrationVersion: artifact.calibration?.version || "uncalibrated-v1",
    artifactHash: expectedArtifactHash,
    gitCommit: artifact.gitCommit,
  };
  const expectedIdentityHash = `0x${sha256(canonicalize(identity))}`;
  if (artifactHash !== expectedArtifactHash || modelIdentityHash !== expectedIdentityHash) {
    throw new Error("Frozen fraud-model artifact hash validation failed");
  }
  return artifact;
};

const assertRequestModelIdentity = (requestModelVersion, artifact) => {
  if (String(requestModelVersion).toLowerCase() !== artifact.modelIdentityHash.toLowerCase()) {
    throw new Error(`Oracle request model identity ${requestModelVersion} does not match runtime artifact ${artifact.modelIdentityHash}`);
  }
};

module.exports = { assertRequestModelIdentity, canonicalize, loadAndVerifyModelArtifact };
