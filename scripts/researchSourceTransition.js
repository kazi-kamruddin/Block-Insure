const { isDeepStrictEqual } = require("node:util");
const { withoutVolatileMeasurements } = require("../backEnd/services/researchArtifactService");
const { researchManifestReproducibilityBasis } = require("../backEnd/scripts/generateResearchManifest");

// Bookkeeping is not an experimental input. All other differences need an exact,
// reviewed transition receipt; this does not revalidate historical measurements.
const METADATA_TOOLS = ["scripts/prepareReleaseCandidate.js", "scripts/verifyRepository.js"];
const manifestBasis = (manifest) => {
  const value = withoutVolatileMeasurements(researchManifestReproducibilityBasis(manifest));
  return { ...value, implementation: Object.fromEntries(Object.entries(value.implementation || {})
    .filter(([file]) => !METADATA_TOOLS.includes(file))) };
};

function sourceDifferences(recorded, current) {
  const changes = [];
  function visit(before, after, segments) {
    if (isDeepStrictEqual(before, after)) return;
    if (before && after && typeof before === "object" && typeof after === "object"
      && !Array.isArray(before) && !Array.isArray(after)) {
      for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
        visit(before[key], after[key], [...segments, key]);
      }
    } else changes.push({ path: segments, before: before ?? null, after: after ?? null });
  }
  visit(manifestBasis(recorded), manifestBasis(current), []);
  return changes;
}

function verifySourceTransition(recorded, current, receipt, historicalFileSha256) {
  if (receipt?.schemaVersion !== 1 || receipt?.historicalManifestSha256 !== historicalFileSha256
    || receipt?.historicalReproducibilityHash !== recorded.reproducibilityHash
    || receipt?.evidenceStatus !== "HISTORICAL_NOT_REVALIDATED"
    || !Array.isArray(receipt?.changes) || !receipt.changes.length) return false;
  const declared = receipt.changes.map(({ path, before, after, reason }) => {
    if (!Array.isArray(path) || typeof reason !== "string" || !reason.trim()) return null;
    return { path, before, after };
  });
  return isDeepStrictEqual(sourceDifferences(recorded, current), declared);
}

module.exports = { METADATA_TOOLS, sourceDifferences, verifySourceTransition };
