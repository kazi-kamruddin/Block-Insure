const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { canonicalize } = require("./modelArtifactService");

const VOLATILE_KEYS = new Set([
  "generatedAt",
  "evaluationTimeMs",
  "totalInferenceTimeMs",
  "meanInferenceTimeMs",
  "buildAndProveMs",
  "coldTreeBuildMs",
  "meanProofBuildMs",
  "meanProofVerificationMs",
  "heapDeltaBytes",
  "executionFileSha256",
]);

const withoutVolatileMeasurements = (value) => {
  if (Array.isArray(value)) return value.map(withoutVolatileMeasurements);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !VOLATILE_KEYS.has(key) && key !== "reproducibilityHash")
      .map(([key, item]) => [key, withoutVolatileMeasurements(item)])
  );
};

const calculateReproducibilityHash = (artifact) =>
  crypto
    .createHash("sha256")
    .update(canonicalize(withoutVolatileMeasurements(artifact)))
    .digest("hex");

const atomicWriteFileSync = (filePath, contents, encoding = "utf8") => {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  try {
    fs.writeFileSync(temporaryPath, contents, { encoding, mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
};

module.exports = {
  VOLATILE_KEYS,
  atomicWriteFileSync,
  calculateReproducibilityHash,
  withoutVolatileMeasurements,
};
