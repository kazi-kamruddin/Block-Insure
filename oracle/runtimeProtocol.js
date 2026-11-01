// Version-dispatch registry. Historic NB requests retain their exact evaluator;
// publishing a new default never changes an already snapshotted request ID.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { canonicalize, loadAndVerifyModelArtifact } = require("./modelArtifact");
const { loadAdvisoryBundle } = require("./advisoryBundle");
const root = path.resolve(__dirname, "..");
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const SOURCES = ["oracle/protocolAssessment.js", "oracle/runtimeProtocol.js", "oracle/protocol.js", "oracle/recordIdentity.js", "oracle/merkleProof.js", "oracle/index.js"];
function buildProtocolArtifact(loaded = loadAdvisoryBundle()) {
  const legacy = loadAndVerifyModelArtifact();
  const payload = { schema: "xgboost-oracle-routing-v4", modelVersion: "xgboost-protocol-v4", inferenceEngineVersion: "xgboost-context-v1",
    bundleHash: loaded.bundleHash, manifestHash: loaded.manifestHash,
    legacyModelIdentityHash: legacy.modelIdentityHash, thresholdUnits: loaded.bundle.policy.thresholdUnits,
    decision: { uncertaintyAloneEscalates: false, unavailableMayApprove: false, rejectOnModelScore: false,
      completeContextRequired: true, scoreComparison: ">=", capacityGuarantee: false },
    sourceHashes: Object.fromEntries(SOURCES.map((file) => [file, sha(fs.readFileSync(path.join(root, file)))])) };
  return { ...payload, modelIdentityHash: `0x${sha(canonicalize(payload))}` };
}
function loadProtocolArtifact() {
  const artifact = JSON.parse(fs.readFileSync(path.join(root, "backEnd/artifacts/xgboost-protocol-v4.json"), "utf8"));
  const expected = buildProtocolArtifact();
  if (canonicalize(artifact) !== canonicalize(expected)) throw new Error("XGBoost protocol package is stale or incompatible");
  return artifact;
}
function resolveRequestModel(identity) {
  const legacy = loadAndVerifyModelArtifact();
  if (String(identity).toLowerCase() === legacy.modelIdentityHash.toLowerCase()) return { kind: "legacy-nb", artifact: legacy };
  const active = loadProtocolArtifact();
  if (String(identity).toLowerCase() !== active.modelIdentityHash.toLowerCase()) throw new Error("Unsupported request model identity");
  return { kind: "xgboost", artifact: active };
}
module.exports = { SOURCES, buildProtocolArtifact, loadProtocolArtifact, resolveRequestModel };
