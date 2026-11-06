// Request identity selects frozen inference and appeal-proof semantics.
// Operational releases are separately source-bound; no unchecked fallback.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { canonicalize, loadAndVerifyModelArtifact } = require("./modelArtifact");
const { loadAdvisoryBundle } = require("./advisoryBundle");
const root = path.resolve(__dirname, "..");
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const PROFILE_FILE = "backEnd/artifacts/xgboost-protocol-v4.json";
const PROFILE_SHA = "3799e45de1e9be95aa728cb33308eab163b0b685a1542779a503a2c494a93ff9";
const ACTIVE_FILE = "backEnd/artifacts/xgboost-protocol-v5.json";
const FROZEN_SOURCES = ["oracle/protocolAssessment.js", "oracle/runtimeProtocol.js", "oracle/protocol.js", "oracle/recordIdentity.js", "oracle/merkleProof.js", "oracle/index.js"];
const SOURCES = ["oracle/protocolAssessment.js", "oracle/protocol.js", "oracle/recordIdentity.js", "oracle/merkleProof.js", "oracle/appealValidation.js"];
const RUNTIME_FILES = ["oracle/index.js", "oracle/runtimeProtocol.js", "oracle/scanRecovery.js", "oracle/workerHealth.js", "oracle/appealValidation.js"];
const RELEASE_FILE = "backEnd/artifacts/oracle-runtime-compatibility-v2.json";
const fail = () => { throw new Error("Oracle protocol or operational release integrity mismatch"); };
const exactKeys = (value, keys) => value && !Array.isArray(value) &&
  canonicalize(Object.keys(value).sort()) === canonicalize([...keys].sort());
const read = file => fs.readFileSync(path.join(root, file));

function frozenProfile() {
  const bytes = read(PROFILE_FILE);
  if (sha(bytes) !== PROFILE_SHA) fail();
  const artifact = JSON.parse(bytes);
  const { modelIdentityHash, ...payload } = artifact;
  if (modelIdentityHash !== `0x${sha(canonicalize(payload))}` || !exactKeys(artifact.sourceHashes, FROZEN_SOURCES)) fail();
  return artifact;
}
function activeProfile(frozen) {
  const artifact = JSON.parse(read(ACTIVE_FILE)), { modelIdentityHash, ...payload } = artifact;
  if (!exactKeys(artifact, [...Object.keys(frozen), "appealProofVersion"]) ||
      artifact.schema !== "xgboost-oracle-routing-v5" || artifact.modelVersion !== "xgboost-protocol-v5" ||
      artifact.appealProofVersion !== "trusted-appeal-events-v2" ||
      modelIdentityHash !== `0x${sha(canonicalize(payload))}` || !exactKeys(artifact.sourceHashes, SOURCES)) fail();
  for (const key of ["inferenceEngineVersion", "bundleHash", "manifestHash", "legacyModelIdentityHash", "thresholdUnits", "decision"])
    if (canonicalize(artifact[key]) !== canonicalize(frozen[key])) fail();
  for (const file of SOURCES) {
    if (sha(read(file)) !== artifact.sourceHashes[file]) fail();
    if (file !== "oracle/appealValidation.js" && artifact.sourceHashes[file] !== frozen.sourceHashes[file]) fail();
  }
  return artifact;
}
function verifyRelease(frozen, active) {
  const release = JSON.parse(read(RELEASE_FILE));
  if (!exactKeys(release, ["schema", "release", "compatibleModelIdentityHashes", "frozenProfileSha256", "activeProfileSha256", "files", "runtimeIdentityHash"]) ||
      release.schema !== "oracle-runtime-compatibility-v2" || release.release !== "oracle-appeal-proof-v2" ||
      canonicalize(release.compatibleModelIdentityHashes) !== canonicalize([active.legacyModelIdentityHash, frozen.modelIdentityHash, active.modelIdentityHash]) ||
      release.frozenProfileSha256 !== PROFILE_SHA || release.activeProfileSha256 !== sha(read(ACTIVE_FILE)) ||
      !exactKeys(release.files, RUNTIME_FILES)) fail();
  const { runtimeIdentityHash, ...payload } = release;
  if (runtimeIdentityHash !== `0x${sha(canonicalize(payload))}`) fail();
  for (const file of RUNTIME_FILES) if (sha(read(file)) !== release.files[file]) fail();
  return release;
}
function verified(loaded = loadAdvisoryBundle()) {
  const frozen = frozenProfile(), active = activeProfile(frozen), legacy = loadAndVerifyModelArtifact();
  if (active.bundleHash !== loaded.bundleHash || active.manifestHash !== loaded.manifestHash ||
      active.legacyModelIdentityHash !== legacy.modelIdentityHash || active.thresholdUnits !== loaded.bundle.policy.thresholdUnits) fail();
  return { frozen, active, legacy, release: verifyRelease(frozen, active) };
}
function loadOperationalRelease() { return verified().release; }
function buildProtocolArtifact(loaded = loadAdvisoryBundle()) { return verified(loaded).active; }
function loadProtocolArtifact() { return buildProtocolArtifact(); }
function loadHistoricalProtocolArtifact() { return verified().frozen; }
function resolveRequestModel(identity) {
  const { frozen, active, legacy } = verified();
  const normalized = String(identity).toLowerCase();
  if (normalized === legacy.modelIdentityHash.toLowerCase()) return { kind: "legacy-nb", artifact: legacy };
  for (const artifact of [frozen, active]) if (normalized === artifact.modelIdentityHash.toLowerCase()) return { kind: "xgboost", artifact };
  throw new Error("Unsupported request model identity");
}
module.exports = { SOURCES, buildProtocolArtifact, loadProtocolArtifact, loadHistoricalProtocolArtifact, resolveRequestModel, loadOperationalRelease };
