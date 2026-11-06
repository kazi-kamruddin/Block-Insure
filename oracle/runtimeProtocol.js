// A request pins its frozen evaluator profile, not the operational release.
// Compatibility is approved by the trusted repository release; it is not a
// signature, remote attestation, or permission to accept arbitrary edits.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { canonicalize, loadAndVerifyModelArtifact } = require("./modelArtifact");
const { loadAdvisoryBundle } = require("./advisoryBundle");
const root = path.resolve(__dirname, "..");
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const PROFILE_FILE = "backEnd/artifacts/xgboost-protocol-v4.json";
const PROFILE_SHA = "3799e45de1e9be95aa728cb33308eab163b0b685a1542779a503a2c494a93ff9";
const SOURCES = ["oracle/protocolAssessment.js", "oracle/runtimeProtocol.js", "oracle/protocol.js", "oracle/recordIdentity.js", "oracle/merkleProof.js", "oracle/index.js"];
const RUNTIME_FILES = ["oracle/index.js", "oracle/runtimeProtocol.js", "oracle/scanRecovery.js", "oracle/workerHealth.js"];
const RELEASE_FILE = "backEnd/artifacts/oracle-runtime-compatibility-v1.json";
const fail = () => { throw new Error("Oracle protocol or operational release integrity mismatch"); };
const exactKeys = (value, keys) => value && !Array.isArray(value) &&
  canonicalize(Object.keys(value).sort()) === canonicalize([...keys].sort());
const read = file => fs.readFileSync(path.join(root, file));

function frozenProfile() {
  const bytes = read(PROFILE_FILE);
  if (sha(bytes) !== PROFILE_SHA) fail();
  const artifact = JSON.parse(bytes);
  const { modelIdentityHash, ...payload } = artifact;
  if (modelIdentityHash !== `0x${sha(canonicalize(payload))}` || !exactKeys(artifact.sourceHashes, SOURCES)) fail();
  return artifact;
}
function verifyRelease(artifact) {
  const release = JSON.parse(read(RELEASE_FILE));
  if (!exactKeys(release, ["schema", "release", "compatibleModelIdentityHash", "frozenProfileSha256", "files", "runtimeIdentityHash"]) ||
      release.schema !== "oracle-runtime-compatibility-v1" || release.release !== "oracle-backlog-recovery-v1" ||
      release.compatibleModelIdentityHash !== artifact.modelIdentityHash || release.frozenProfileSha256 !== PROFILE_SHA ||
      !exactKeys(release.files, RUNTIME_FILES)) fail();
  const { runtimeIdentityHash, ...payload } = release;
  if (runtimeIdentityHash !== `0x${sha(canonicalize(payload))}`) fail();
  for (const file of RUNTIME_FILES) if (sha(read(file)) !== release.files[file]) fail();
  // The entrypoint and loader are the only frozen-source exceptions. Their exact
  // approved replacements are covered above. Evaluator sources stay frozen.
  for (const file of SOURCES) {
    if (file !== "oracle/index.js" && file !== "oracle/runtimeProtocol.js" && sha(read(file)) !== artifact.sourceHashes[file]) fail();
  }
  return release;
}
function verifyEvaluator(artifact, loaded) {
  const legacy = loadAndVerifyModelArtifact();
  if (artifact.bundleHash !== loaded.bundleHash || artifact.manifestHash !== loaded.manifestHash ||
      artifact.legacyModelIdentityHash !== legacy.modelIdentityHash || artifact.thresholdUnits !== loaded.bundle.policy.thresholdUnits) fail();
}
function loadOperationalRelease() {
  const artifact = frozenProfile();
  verifyEvaluator(artifact, loadAdvisoryBundle());
  return verifyRelease(artifact);
}
// Reconstruct the immutable request profile only after checking the operational
// release. This API never re-freezes the currently installed source files.
function buildProtocolArtifact(loaded = loadAdvisoryBundle()) {
  const artifact = frozenProfile();
  verifyEvaluator(artifact, loaded);
  verifyRelease(artifact);
  return artifact;
}
function loadProtocolArtifact() { return buildProtocolArtifact(); }
function resolveRequestModel(identity) {
  const legacy = loadAndVerifyModelArtifact();
  if (String(identity).toLowerCase() === legacy.modelIdentityHash.toLowerCase()) return { kind: "legacy-nb", artifact: legacy };
  const active = loadProtocolArtifact();
  if (String(identity).toLowerCase() !== active.modelIdentityHash.toLowerCase()) throw new Error("Unsupported request model identity");
  return { kind: "xgboost", artifact: active };
}
module.exports = { SOURCES, buildProtocolArtifact, loadProtocolArtifact, resolveRequestModel, loadOperationalRelease };
