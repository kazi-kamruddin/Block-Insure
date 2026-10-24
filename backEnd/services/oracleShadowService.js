const { ethers } = require("ethers");
const { getReadOnlyContract, getOracleCoordinator } = require("./contractService");
const { readCommittedRecords, loadAdvisoryBundle } = require("./xgboostAdvisoryService");
const { getCanonicalRecordPayload } = require("./merkleRegistryService");
const { facts, binding, hash, signedMessage, assessShadowPacket } = require("../../oracle/shadowAssessment");
const error = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

async function authorizedRequest(input, action, digest = "") {
  if (!input || typeof input !== "object" || !/^[1-9]\d{0,17}$/.test(String(input.requestId)) || !["1", "2"].includes(String(input.oracleInstanceId)) || !ethers.isAddress(input.oracleWallet) ||
      !Number.isSafeInteger(input.timestamp) || Math.abs(Date.now() - input.timestamp) > 120000 || typeof input.signature !== "string" || input.signature.length > 200) throw error("Invalid or stale shadow authorization", 401);
  const contract = getReadOnlyContract(), provider = contract.runner.provider;
  try {
    const coordinator = await getOracleCoordinator(contract);
    const network = await provider.getNetwork();
    const coordinatorAddress = await coordinator.getAddress();
    let signer;
    try {
      signer = ethers.verifyMessage(signedMessage({ action, requestId: input.requestId, wallet: input.oracleWallet, timestamp: input.timestamp,
        digest, chainId: network.chainId, coordinatorAddress }), input.signature);
    } catch { throw error("Invalid shadow signature", 401); }
    if (signer.toLowerCase() !== input.oracleWallet.toLowerCase()) throw error("Invalid shadow signer", 401);
    const block = await provider.getBlock("latest"), tag = { blockTag: block.number };
    const [request, eligible, role] = await Promise.all([coordinator.getRequest(input.requestId, tag),
      coordinator.eligibleForRequest(input.requestId, signer, tag), contract.ORACLE_ROLE(tag)]);
    if (!eligible || !await contract.hasRole(role, signer, tag)) throw error("Oracle is not eligible for shadow request", 403);
    const [claim, version, snapshot] = await Promise.all([contract.getClaim(request.claimId, tag), contract.claimVersion(request.claimId, tag),
      coordinator.getRegistrySnapshot(request.registryVersion, tag)]);
    if (String(version) !== String(request.claimVersion) || snapshot.root.toLowerCase() !== request.registryRoot.toLowerCase()) throw error("Shadow request is stale", 409);
    const requestBlock = await provider.getBlock(Number(request.requestBlock));
    const authoritative = { request, claim: facts({ ...claim.toObject(), claimAmountEth: ethers.formatEther(claim.claimAmount) }), requestBlockHash: requestBlock.hash,
      chainId: String(network.chainId), managerAddress: await contract.getAddress(), coordinatorAddress, snapshotTimestamp: String(snapshot.publishedAt) };
    return { authoritative, wallet: signer.toLowerCase(), provider, contract, block };
  } catch (failure) { provider.destroy(); throw failure; }
}

async function withPacket(input, action, digest, callback) {
  const auth = await authorizedRequest(input, action, digest);
  try {
    const loaded = loadAdvisoryBundle();
    const bound = binding({ ...auth.authoritative, bundleHash: loaded.bundleHash, manifestHash: loaded.manifestHash });
    const records = await readCommittedRecords(bound.registryRoot);
    if (!records.some((record) => record.invoiceHash.toLowerCase() === auth.authoritative.claim.invoiceHash.toLowerCase())) throw error("Invoice unavailable in shadow snapshot", 409);
    const packet = { version: "request-shadow-v1", binding: bound, contextId: hash(bound), records: records.map(getCanonicalRecordPayload) };
    const result = await callback(packet, auth, loaded);
    const [version, block] = await Promise.all([auth.contract.claimVersion(bound.claimId), auth.provider.getBlock(auth.block.number)]);
    if (String(version) !== bound.claimVersion || block?.hash !== auth.block.hash) throw error("Chain changed during shadow assessment", 409);
    return result;
  } finally { auth.provider.destroy(); }
}
const getPacket = (input) => withPacket(input, "CONTEXT", "", async (packet) => packet);
const saveReport = async (input) => {
  const report = input?.report, result = report?.result, metrics = input?.metrics;
  if (!report || Array.isArray(report) || Object.keys(report).length !== 5 ||
      ["contextId", "resultHash", "contextHash", "explanationHash"].some((key) => !/^[a-f0-9]{64}$/.test(report[key])) ||
      !result || Array.isArray(result) || Object.keys(result).length !== 7 || !Number.isSafeInteger(result.scoreUnits) || result.scoreUnits < 0 || result.scoreUnits > 1e9 ||
      !["REVIEW_RECOMMENDED", "NO_ADDITIONAL_MODEL_REVIEW"].includes(result.recommendation) || typeof result.oodWarning !== "boolean" ||
      !Array.isArray(result.reasons) || result.reasons.length > 4 || result.reasons.some((v) => typeof v !== "string" || v.length > 64) ||
      !Array.isArray(result.predictionSet) || result.predictionSet.length > 2 || result.predictionSet.some((v) => !["CONTROL", "SIMULATED_ACTION"].includes(v)) ||
      typeof result.policyVersion !== "string" || result.policyVersion.length > 64 || !Number.isSafeInteger(result.thresholdUnits) || result.thresholdUnits < 0 || result.thresholdUnits > 1e9 + 1 ||
      !metrics || Array.isArray(metrics) || Object.keys(metrics).length !== 4 || ["totalMs", "scoringMs", "rssBytes", "heapUsedBytes"].some((key) => !Number.isFinite(metrics[key]) || metrics[key] < 0 || metrics[key] > 1e12)) throw error("Invalid shadow report");
  return withPacket(input, "REPORT", hash({ report, metrics }), async (packet, auth, loaded) => {
  const expected = assessShadowPacket(packet, auth.authoritative, loaded);
  for (const key of ["contextId", "resultHash", "contextHash", "explanationHash"]) if (input.report?.[key] !== expected[key]) throw error("Shadow assessment does not match committed context", 409);
  if (hash(input.report.result) !== expected.resultHash) throw error("Invalid shadow result", 409);
  const Model = require("../models/OracleShadowAssessment");
  const row = { _id: hash([packet.contextId, auth.wallet]), contextId: packet.contextId, requestId: packet.binding.requestId,
    claimId: packet.binding.claimId, claimVersion: packet.binding.claimVersion, coordinatorAddress: packet.binding.coordinatorAddress,
    oracleWallet: auth.wallet, oracleInstanceId: String(input.oracleInstanceId), binding: packet.binding, result: expected.result,
    resultHash: expected.resultHash, contextHash: expected.contextHash, explanationHash: expected.explanationHash,
    metrics: Object.fromEntries(["totalMs", "scoringMs", "rssBytes", "heapUsedBytes"].map((key) => [key, metrics[key]])) };
  try { await Model.updateOne({ _id: row._id }, { $setOnInsert: row }, { upsert: true }); }
  catch (failure) { if (failure.code !== 11000) throw failure; }
  return { accepted: true, contextId: row.contextId, resultHash: row.resultHash };
  });
};

async function getAgreement({ requestId, claimVersion, registryRoot, bundleHash, manifestHash, coordinatorAddress, chainId, requestBlockHash }) {
  if (!requestId || String(requestId) === "0") return { status: "NO_CURRENT_REQUEST", reports: 0 };
  const rows = await require("../models/OracleShadowAssessment").find({ requestId: String(requestId), claimVersion: String(claimVersion),
    coordinatorAddress: coordinatorAddress.toLowerCase(), "binding.chainId": String(chainId), "binding.requestBlockHash": requestBlockHash.toLowerCase(),
    "binding.registryRoot": registryRoot.toLowerCase(), "binding.bundleHash": bundleHash, "binding.manifestHash": manifestHash }).limit(3).lean();
  const wallets = new Set(rows.map((row) => row.oracleWallet));
  const same = rows.length >= 2 && new Set(rows.map((row) => `${row.contextId}:${row.resultHash}:${row.contextHash}:${row.explanationHash}`)).size === 1;
  return { status: wallets.size < 2 ? "WAITING_FOR_WORKERS" : same ? "MATCHED" : "CONFLICT", reports: wallets.size,
    authority: "SHADOW_ONLY", contextId: rows[0]?.contextId || null,
    note: "Matching execution over a shared registry/model is not independent medical truth" };
}
module.exports = { authorizedRequest, getPacket, saveReport, getAgreement };
