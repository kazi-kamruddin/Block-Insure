const crypto = require("node:crypto");

const canonicalize = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

const artifactPayload = (artifact) => {
  const { artifactHash, modelIdentityHash, ...payload } = artifact;
  return payload;
};

const calculateArtifactHash = (artifact) =>
  sha256(canonicalize(artifactPayload(artifact)));

const buildModelIdentity = (artifact) => ({
  modelVersion: artifact.modelVersion,
  trainingDataHash: artifact.trainingDataHash,
  featureSchemaVersion: artifact.featureSchemaVersion,
  threshold: artifact.threshold,
  calibrationVersion: artifact.calibration?.version || "uncalibrated-v1",
  artifactHash: artifact.artifactHash,
  gitCommit: artifact.gitCommit,
});

const calculateModelIdentityHash = (artifact) =>
  `0x${sha256(canonicalize(buildModelIdentity(artifact)))}`;

const freezeModelArtifact = (artifact) => {
  const frozen = {
    ...artifactPayload(artifact),
    artifactHash: calculateArtifactHash(artifact),
  };
  frozen.modelIdentityHash = calculateModelIdentityHash(frozen);
  return frozen;
};

const verifyModelArtifact = (artifact) => {
  const errors = [];
  const expectedArtifactHash = calculateArtifactHash(artifact);
  if (artifact.artifactHash !== expectedArtifactHash) {
    errors.push("artifactHash does not match canonical model parameters");
  }
  const expectedIdentityHash = calculateModelIdentityHash({
    ...artifact,
    artifactHash: expectedArtifactHash,
  });
  if (artifact.modelIdentityHash !== expectedIdentityHash) {
    errors.push("modelIdentityHash does not match the frozen model identity");
  }
  return {
    valid: errors.length === 0,
    errors,
    expectedArtifactHash,
    expectedIdentityHash,
  };
};

const calculateTrainingDataHash = (records) =>
  sha256(
    canonicalize(
      records.map((record) => ({
        recordId: record.recordId || record.invoiceNumber || record.invoiceHash,
        claimantId: record.claimantId || record.patientHash,
        providerId: record.providerId || record.hospitalId,
        occurredAt: new Date(record.occurredAt || record.admissionDate).toISOString(),
        fraudLabel: record.fraudLabel,
        features: record.features || null,
      }))
    )
  );

module.exports = {
  buildModelIdentity,
  calculateArtifactHash,
  calculateModelIdentityHash,
  calculateTrainingDataHash,
  canonicalize,
  freezeModelArtifact,
  verifyModelArtifact,
};
