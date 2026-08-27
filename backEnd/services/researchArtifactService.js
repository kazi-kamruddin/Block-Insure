const crypto = require("node:crypto");
const { canonicalize } = require("./modelArtifactService");

const VOLATILE_KEYS = new Set([
  "generatedAt",
  "evaluationTimeMs",
  "totalInferenceTimeMs",
  "meanInferenceTimeMs",
  "buildAndProveMs",
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

module.exports = {
  VOLATILE_KEYS,
  calculateReproducibilityHash,
  withoutVolatileMeasurements,
};
