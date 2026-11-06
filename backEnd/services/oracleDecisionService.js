const { authorizedRequest, getPacket } = require("./oracleShadowService");
const { hash } = require("../../oracle/shadowAssessment");
const { resolveRequestModel } = require("../../oracle/runtimeProtocol");
const { assessProtocol, unavailable } = require("../../oracle/protocolAssessment");
const fail = () => Object.assign(new Error("Protocol decision is invalid or unavailable"), { statusCode: 409 });
async function decision(input, save = false) {
  // Bound metadata only; never allow arbitrary diagnostic payloads to persist.
  if (save && (!input?.assessment || Array.isArray(input.assessment) || JSON.stringify(input.assessment).length > 20000)) throw fail();
  const auth = await authorizedRequest(input, save ? "DECISION_SAVE" : "DECISION_READ", save ? hash(input.assessment) : "");
  try {
    const a = auth.authoritative, selected = resolveRequestModel(a.request.modelVersion), active = selected.artifact;
    if (selected.kind !== "xgboost") throw fail();
    const identity = { requestId: String(a.request.requestId), claimVersion: String(a.request.claimVersion), modelIdentity: active.modelIdentityHash,
      requestBlockHash: a.requestBlockHash.toLowerCase(), coordinatorAddress: a.coordinatorAddress.toLowerCase(), chainId: a.chainId, oracleWallet: auth.wallet };
    const _id = hash(identity), Model = require("../models/OracleProtocolDecision");
    if (save) {
      const value = input.assessment;
      if (value.model !== "XGBoost" || typeof value.verified !== "boolean" || !["ORACLE_ROUTING", "INTEGRITY_GATE"].includes(value.authority)) throw fail();
      if (value.verified || value.assessment) {
        // A distinct CONTEXT signature is required to recompute from the pinned
        // archive; never trust a client-supplied numerical recommendation.
        const packet = await getPacket(input.contextAuthorization);
        const expected = assessProtocol(packet, a);
        if (hash(expected) !== hash(value)) throw fail();
      } else {
        const codes = ["APPEAL_COMMITMENT_MISMATCH", "SNAPSHOT_ID_MISMATCH", "INVALID_MERKLE_PROOF", "REGISTRY_ROOT_MISMATCH", "CLAIM_RECORD_MISMATCH"];
        const expected = value.verificationCode === "XGB_CONTEXT_OR_INFERENCE_UNAVAILABLE" ? unavailable() :
          codes.includes(value.verificationCode) ? { verified: false, model: "XGBoost", authority: "INTEGRITY_GATE", score: null,
            riskLevel: "HIGH", verificationCode: value.verificationCode } : null;
        if (!expected || hash(expected) !== hash(value)) throw fail();
      }
      const block = await auth.provider.getBlock(auth.block.number);
      if (block?.hash !== auth.block.hash || String(await auth.contract.claimVersion(a.request.claimId)) !== identity.claimVersion) throw fail();
      try { await Model.updateOne({ _id }, { $setOnInsert: { _id, ...identity, assessment: value } }, { upsert: true }); }
      catch (error) { if (error.code !== 11000) throw error; }
    }
    const row = await Model.findById(_id).lean();
    return { assessment: row?.assessment || null };
  } finally { auth.provider.destroy(); }
}
// Called only after the controller verifies the mined reveal transaction.
// Do not let caller-supplied log metadata manufacture monitoring scores/scope.
async function validateProtocolLog({ contract, coordinator, requestId, oracleWallet, responseData, resultHash }) {
  const request = await coordinator.getRequest(requestId), selected = resolveRequestModel(request.modelVersion), active = selected.artifact;
  if (selected.kind !== "xgboost") return {
    ...responseData, modelIdentity: { ...responseData.modelIdentity, role: "HISTORICAL_REQUEST" },
  };
  const provider = contract.runner.provider, [network, block, coordinatorAddress] = await Promise.all([
    provider.getNetwork(), provider.getBlock(Number(request.requestBlock)), coordinator.getAddress(),
  ]);
  const identity = { requestId: String(request.requestId), claimVersion: String(request.claimVersion), modelIdentity: active.modelIdentityHash,
    requestBlockHash: block.hash.toLowerCase(), coordinatorAddress: coordinatorAddress.toLowerCase(), chainId: String(network.chainId), oracleWallet };
  const row = await require("../models/OracleProtocolDecision").findById(hash(identity)).lean();
  // Worker envelopes also contain proof diagnostics. Compare the pinned routing
  // fields and store the canonical receipt, not arbitrary envelope extensions.
  const reported = row && responseData.assessment && Object.fromEntries(
    Object.keys(row.assessment).map((key) => [key, responseData.assessment[key]])
  );
  if (!row || !reported || hash(row.assessment) !== hash(reported)) throw fail();
  const proof = responseData.hospitalVerification?.merkleProof;
  const { ethers } = require("ethers");
  const leafHash = require("../../oracle/merkleProof").verifyRegistryProof(proof) ? proof.leafHash : ethers.ZeroHash;
  const expected = require("../../oracle/protocol").buildResultHash({ request, verified: row.assessment.verified,
    verificationCode: row.assessment.verificationCode, leafHash });
  if (expected.toLowerCase() !== String(resultHash).toLowerCase()) throw fail();
  return { ...responseData, assessment: row.assessment, deployment: { coordinatorAddress: identity.coordinatorAddress, chainId: identity.chainId },
    modelIdentity: { modelVersion: active.modelVersion, modelIdentityHash: active.modelIdentityHash, artifactHash: active.bundleHash, role: "ORACLE_ROUTING" },
    queryData: { ...responseData.queryData, claimVersion: identity.claimVersion, modelVersion: identity.modelIdentity } };
}
module.exports = { decision, validateProtocolLog };
