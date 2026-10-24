// Independent worker context/root verification. Never reads labels as features
// and never returns a value used by Oracle commit/reveal.
const crypto = require("node:crypto");
const { hashCanonicalRecord, hashPair } = require("./merkleProof");
const { prepareAdvisoryObservation } = require("../backEnd/services/advisoryContextService");
const { loadAdvisoryBundle } = require("./advisoryBundle");
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object"
  ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const hash = (value) => crypto.createHash("sha256").update(canonical(value)).digest("hex");
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
function registryRoot(records) {
  if (!Array.isArray(records) || !records.length || records.length > 10000) throw new Error("Invalid shadow archive size");
  const sorted = records.slice().sort((a, b) => `${a.invoiceHash.toLowerCase()}-${a.invoiceNumber || ""}`.localeCompare(`${b.invoiceHash.toLowerCase()}-${b.invoiceNumber || ""}`));
  let level = sorted.map(hashCanonicalRecord);
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(hashPair(level[i], level[i + 1] || level[i]));
    level = next;
  }
  return level[0];
}
function facts(claim) {
  return Object.fromEntries(["claimId", "claimantWallet", "claimAmountEth", "hospitalId", "invoiceHash", "incidentDate", "claimType", "submittedAt"]
    .map((key) => [key, String(claim[key])]).map(([key, value]) => [key, ["claimantWallet", "invoiceHash"].includes(key) ? value.toLowerCase() : value]));
}
function binding({ request, claim, chainId, managerAddress, coordinatorAddress, snapshotTimestamp, requestBlockHash, bundleHash, manifestHash }) {
  return { version: "request-shadow-v1", chainId: String(chainId), managerAddress: managerAddress.toLowerCase(), coordinatorAddress: coordinatorAddress.toLowerCase(),
    requestId: String(request.requestId), claimId: String(request.claimId), claimVersion: String(request.claimVersion), registryVersion: String(request.registryVersion),
    registryRoot: request.registryRoot.toLowerCase(), snapshotTimestamp: String(snapshotTimestamp), requestBlockHash: String(requestBlockHash).toLowerCase(),
    bundleHash, manifestHash, factsHash: hash(facts(claim)) };
}
function summary(assessment) {
  return { scoreUnits: assessment.riskScoreUnits, recommendation: assessment.recommendation, reasons: assessment.reasons,
    predictionSet: assessment.uncertainty.predictionSet, oodWarning: assessment.uncertainty.ood.warning,
    policyVersion: assessment.policy.version, thresholdUnits: assessment.policy.thresholdUnits };
}
function assessShadowPacket(packet, authoritative, loaded = loadAdvisoryBundle()) {
  const expected = binding({ ...authoritative, bundleHash: loaded.bundleHash, manifestHash: loaded.manifestHash });
  if (packet?.version !== "request-shadow-v1" || hash(packet.binding) !== hash(expected) || packet.contextId !== hash(expected)) throw new Error("Shadow request/context identity mismatch");
  if (!same(registryRoot(packet.records), expected.registryRoot)) throw new Error("Shadow archive root mismatch");
  const prepared = prepareAdvisoryObservation({ records: packet.records, claim: facts(authoritative.claim), snapshotTimestamp: authoritative.snapshotTimestamp });
  const assessment = loaded.engine.score(prepared.observation);
  const result = summary(assessment);
  return { contextId: packet.contextId, result, resultHash: hash(result), contextHash: hash(prepared.observation),
    explanationHash: hash(assessment.explanation), context: prepared.context };
}
function signedMessage({ action, requestId, wallet, timestamp, digest = "", chainId, coordinatorAddress }) {
  return ["Block-Insure XGBoost shadow v1", action, String(chainId), coordinatorAddress.toLowerCase(), String(requestId), wallet.toLowerCase(), String(timestamp), digest].join(":");
}
function createShadowRunner({ run, onFailure = () => {}, maxRemembered = 128 }) {
  const completed = new Set(); let busy = false, cursor = 0;
  return async (requests) => {
    if (busy) return;
    busy = true;
    try {
      const identity = (request) => `${request.requestId}:${request.queryHash || ""}:${request.registryRoot || ""}:${request.shadowBlockHash || ""}`;
      const pending = requests.filter((request) => !completed.has(identity(request)));
      const start = pending.length ? cursor % pending.length : 0;
      const batch = [...pending.slice(start), ...pending.slice(0, start)].slice(0, 8); cursor += 8;
      for (const request of batch) {
        const key = identity(request);
        try {
          await run(request); completed.add(key);
          if (completed.size > maxRemembered) completed.delete(completed.values().next().value);
        } catch { onFailure("SHADOW_UNAVAILABLE"); }
      }
    } finally { busy = false; }
  };
}
module.exports = { canonical, hash, registryRoot, facts, binding, summary, assessShadowPacket, signedMessage, createShadowRunner };
