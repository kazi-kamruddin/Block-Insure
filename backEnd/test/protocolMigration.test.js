const test = require("node:test"), assert = require("node:assert/strict");
const load = require("./helpers/loadIsolatedModule");
const { summarize } = require("../services/protocolMonitoringService");
const { normalizeReceipt } = require("../../scripts/networkMeasurement");
const fixture = require("./helpers/shadowFixture");
const { assessProtocol } = require("../../oracle/protocolAssessment");
const { loadProtocolArtifact, loadHistoricalProtocolArtifact } = require("../../oracle/runtimeProtocol");

for (const profileLoader of [loadProtocolArtifact, loadHistoricalProtocolArtifact]) test(`durable ${profileLoader().modelVersion} decisions survive retries and never replace the first commitment assessment`, async () => {
  const f = fixture(), active = profileLoader(); f.authoritative.request.modelVersion = active.modelIdentityHash;
  const rows = new Map(), provider = { getBlock: async () => ({ hash: "canonical" }), destroy() {} };
  const bound = require("../../oracle/shadowAssessment").binding({ ...f.authoritative, bundleHash: f.loaded.bundleHash, manifestHash: f.loaded.manifestHash });
  const packet = { ...f.packet, binding: bound, contextId: require("../../oracle/shadowAssessment").hash(bound) };
  const service = load("services/oracleDecisionService.js", {
    "./oracleShadowService": { authorizedRequest: async () => ({ authoritative: f.authoritative, wallet: f.wallet.address.toLowerCase(), provider,
      contract: { claimVersion: async () => "1" }, block: { number: 10, hash: "canonical" } }), getPacket: async () => packet },
    "../models/OracleProtocolDecision": { updateOne: async (q, update) => { if (!rows.has(q._id)) rows.set(q._id, update.$setOnInsert); }, findById: (id) => ({ lean: async () => rows.get(id) }) },
  });
  const assessment = assessProtocol(packet, f.authoritative);
  assert.equal((await service.decision({}, false)).assessment, null);
  assert.deepEqual((await service.decision({ assessment }, true)).assessment, assessment);
  const unavailable = require("../../oracle/protocolAssessment").unavailable();
  assert.deepEqual((await service.decision({ assessment: unavailable }, true)).assessment, assessment);
  assert.equal(rows.size, 1);
  await assert.rejects(service.decision({ assessment: { ...assessment, verified: !assessment.verified } }, true));
  await assert.rejects(service.decision({ assessment: { ...unavailable, diagnostic: "unapproved payload" } }, true));
});
test("protocol monitoring counts requests rather than worker reports and exposes absence/shift without inferred accuracy", () => {
  const row = (id, score, extra = {}) => ({ requestId: id, queryData: { claimVersion: "1" }, responseData: { modelIdentity: { role: "ORACLE_ROUTING" }, assessment: { model: "XGBoost", verified: false,
    score, verificationCode: "XGB_REVIEW:test", assessment: { context: {}, result: { policyVersion: "p1", predictionSet: [], oodWarning: true } }, ...extra } } });
  const summary = summarize([row("1", 0.8), row("1", 0.8), row("2", null, { unavailable: true })]);
  assert.equal(summary.requestsObserved, 2); assert.equal(summary.scoredRequests, 1);
  assert.equal(summary.inferenceOrContextUnavailable, 1); assert.equal(summary.oneWorkerOnly, 1);
  assert.equal(summary.missingPriorPatientHistory, 1); assert.equal(summary.oodWarnings, 1);
  assert.equal(summary.scoreHistogram[8], 1); assert.match(summary.interpretation, /not accuracy/);
});
test("mined protocol log metadata must match the pinned decision and result hash; deployment scope is server-owned", async () => {
  const f = fixture(), active = loadProtocolArtifact(), { ethers } = require("ethers");
  const { hash, binding } = require("../../oracle/shadowAssessment");
  f.authoritative.request.modelVersion = active.modelIdentityHash;
  f.authoritative.request.queryHash = ethers.id("request-query");
  const bound = binding({ ...f.authoritative, bundleHash: f.loaded.bundleHash, manifestHash: f.loaded.manifestHash });
  const assessment = assessProtocol({ ...f.packet, binding: bound, contextId: hash(bound) }, f.authoritative);
  const proof = { found: true, leafHash: require("../../oracle/merkleProof").hashCanonicalRecord(f.record),
    rootHash: f.authoritative.request.registryRoot, canonicalRecord: f.packet.records[0], proof: [] };
  const resultHash = require("../../oracle/protocol").buildResultHash({ request: f.authoritative.request,
    verified: assessment.verified, verificationCode: assessment.verificationCode, leafHash: proof.leafHash });
  const service = load("services/oracleDecisionService.js", {
    "../models/OracleProtocolDecision": { findById: () => ({ lean: async () => ({ assessment }) }) },
  });
  const input = { requestId: "1", oracleWallet: f.wallet.address.toLowerCase(), resultHash,
    contract: { runner: { provider: { getNetwork: async () => ({ chainId: 31337n }), getBlock: async () => ({ hash: f.authoritative.requestBlockHash }) } } },
    coordinator: { getRequest: async () => f.authoritative.request, getAddress: async () => f.authoritative.coordinatorAddress },
    responseData: { assessment: { ...assessment, leafHash: proof.leafHash, proofValid: true }, hospitalVerification: { merkleProof: proof },
      deployment: { chainId: "wrong" }, queryData: { claimVersion: "wrong" } } };
  const safe = await service.validateProtocolLog(input);
  assert.equal(safe.deployment.chainId, "31337"); assert.equal(safe.queryData.claimVersion, "1");
  assert.equal(safe.modelIdentity.modelIdentityHash, active.modelIdentityHash);
  assert.deepEqual(safe.assessment, assessment);
  await assert.rejects(service.validateProtocolLog({ ...input, resultHash: ethers.ZeroHash }));
  await assert.rejects(service.validateProtocolLog({ ...input, responseData: { ...input.responseData, assessment: { ...assessment, score: 0.9 } } }));
  f.authoritative.request.modelVersion = active.legacyModelIdentityHash;
  const historical = await service.validateProtocolLog(input);
  assert.equal(historical.modelIdentity.role, "HISTORICAL_REQUEST");
});
test("measurement preserves actual gas/fee units and never invents missing L2 fee or finality", () => {
  const receipt = { gasUsed: "0x5208", effectiveGasPrice: "0x2", status: "0x1", blockNumber: "0x10" };
  const row = normalizeReceipt(receipt, { hash: "synthetic-tx" }, { operation: "test" }, { timestamp: "0x100" });
  assert.equal(row.gasUsed, "21000"); assert.equal(row.receiptGasFeeWei, "42000");
  assert.equal(row.l1DataFeeWei, null); assert.equal(row.receiptGasPlusKnownDataFeeWei, null);
  assert.equal(row.executionGasUsed, null); assert.equal(row.stateGasUsed, null);
  const split = normalizeReceipt({ ...receipt, executionGasUsed: "0x2328", stateGasUsed: "0x2ee0" }, { hash: "tx" }, { operation: "test" }, { timestamp: "0x100" });
  assert.equal(split.executionGasUsed, "9000"); assert.equal(split.stateGasUsed, "12000");
  assert.equal(row.observedSubmissionToBlockMs, null);
  assert.throws(() => normalizeReceipt({ ...receipt, effectiveGasPrice: undefined }, { hash: "tx" }, { operation: "test" }, { timestamp: "0x100" }), /price unavailable/);
  assert.equal(normalizeReceipt({ ...receipt, l1Fee: "0x10" }, { hash: "tx" }, { operation: "test" }, { timestamp: "0x100" }).receiptGasPlusKnownDataFeeWei, "42016");
});
test("public deployment guard refuses known local signers and wrong chains without changing local development", () => {
  const { assertDeploymentSigner } = require("../../scripts/deploymentNetworkSafety");
  const { HDNodeWallet, Wallet } = require("ethers");
  const { HARDHAT_NETWORK_MNEMONIC } = require("../../contracts/node_modules/hardhat/internal/core/config/default-config");
  const local = HDNodeWallet.fromPhrase(HARDHAT_NETWORK_MNEMONIC, undefined, "m/44'/60'/0'/0/0").address;
  assert.doesNotThrow(() => assertDeploymentSigner(31337, local, { local: true }));
  assert.throws(() => assertDeploymentSigner(11155111, local), /dedicated/);
  assert.throws(() => assertDeploymentSigner(84532, local), /dedicated/);
  assert.throws(() => assertDeploymentSigner(1, Wallet.createRandom().address), /Unsupported/);
  assert.throws(() => assertDeploymentSigner(84532, local, { local: true }), /31337/);
  assert.doesNotThrow(() => assertDeploymentSigner(84532, Wallet.createRandom().address));
});
