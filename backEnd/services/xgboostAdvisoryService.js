const crypto = require("node:crypto");
const { ethers } = require("ethers");
const { loadAdvisoryBundle } = require("../../oracle/advisoryBundle");
const { prepareAdvisoryObservation, MAX_RECORDS } = require("./advisoryContextService");
const { independentlyAssessRecord } = require("../../oracle/independentAssessment");
const baselineModel = require("../model-params.json");
const baselinePolicy = require("../triage-policy.json");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

async function readCommittedRecords(rootHash) {
  const Chunk = require("../models/RegistrySnapshotChunk");
  const chunks = await Chunk.find({ rootHash: rootHash.toLowerCase() }).sort({ chunkIndex: 1 }).limit(41).lean();
  if (!chunks.length) throw Object.assign(new Error("Snapshot unavailable"), { code: "SNAPSHOT_UNAVAILABLE" });
  if (chunks.length > 40 || chunks.some((chunk, i) => chunk.chunkIndex !== i)) throw Object.assign(new Error("Snapshot incomplete or too large"), { code: "CONTEXT_LIMIT_OR_GAP" });
  const records = chunks.flatMap((chunk) => chunk.records);
  if (records.length > MAX_RECORDS) throw Object.assign(new Error("Snapshot too large"), { code: "CONTEXT_LIMIT_EXCEEDED" });
  const tree = require("./merkleRegistryService").buildMerkleTree(records);
  if (tree.rootHash.toLowerCase() !== rootHash.toLowerCase()) throw Object.assign(new Error("Snapshot corrupt"), { code: "SNAPSHOT_INTEGRITY_FAILURE" });
  return records;
}

function createAdvisoryService({ load = loadAdvisoryBundle, readRecords = readCommittedRecords,
  persist = async (result) => {
    const Model = require("../models/ClaimAdvisoryAssessment");
    try {
      const stored = await Model.findOneAndUpdate({ _id: result.assessmentId }, { $setOnInsert: { assessmentId: result.assessmentId, deploymentId: result.deploymentId,
        claimId: result.claimId, claimVersion: result.claimVersion, assessment: result } }, { upsert: true, returnDocument: "after" }).lean();
      return stored.assessment;
    } catch (error) {
      if (error.code !== 11000) throw error;
      const stored = await Model.findById(result.assessmentId).lean();
      if (!stored) throw error;
      return stored.assessment;
    }
  } } = {}) {
  // Bounded deployment/facts/context/model cache; promises collapse simultaneous reads.
  const cache = new Map();
  let inFlight = 0;
  return async function assess({ claim, claimVersion, deploymentId, registryRoot, registryVersion, snapshotTimestamp, requestId = "0", blockHash }) {
    const { bundle, engine, bundleHash, manifestHash } = load();
    const facts = { claimId: String(claim.claimId), claimVersion: String(claimVersion), claimantWallet: claim.claimantWallet.toLowerCase(),
      claimAmount: String(claim.claimAmount), invoiceHash: claim.invoiceHash.toLowerCase(), hospitalId: claim.hospitalId,
      incidentDate: String(claim.incidentDate), claimType: claim.claimType, submittedAt: String(claim.submittedAt) };
    const binding = { deploymentId, facts, registryRoot: registryRoot.toLowerCase(), registryVersion: String(registryVersion), snapshotTimestamp: String(snapshotTimestamp),
      requestId: String(requestId), bundleHash, manifestHash };
    const assessmentId = hash(JSON.stringify(binding));
    if (cache.has(assessmentId)) return structuredClone(await cache.get(assessmentId));
    if (inFlight >= 2) throw Object.assign(new Error("Advisory busy"), { code: "ADVISORY_BUSY" });
    inFlight++;
    const task = (async () => {
      const assessmentStart = performance.now();
      const records = await readRecords(registryRoot);
      const runtimeClaim = { ...facts, claimAmountEth: ethers.formatEther(claim.claimAmount) };
      const prepared = prepareAdvisoryObservation({ records, claim: runtimeClaim, snapshotTimestamp });
      const start = performance.now();
      const assessment = engine.score(prepared.observation);
      const inferenceMs = performance.now() - start;
      // Comparison uses the same snapshot and observable facts. It is not a
      // replacement for, or an assertion about, an already recorded Oracle vote.
      const protocolRecord = records.find((record) => record.invoiceHash.toLowerCase() === facts.invoiceHash);
      const nb = independentlyAssessRecord({ record: protocolRecord, claim: runtimeClaim, modelArtifact: baselineModel, triagePolicy: baselinePolicy });
      const result = {
        status: "AVAILABLE", primaryModel: "XGBoost", mode: "PROTOCOL_SHADOW", assessmentId, deploymentId,
        claimId: facts.claimId, claimVersion: facts.claimVersion, recordedAt: new Date().toISOString(),
        binding: { ...binding, facts: undefined, readBlockHash: blockHash },
        context: prepared.context, assessment,
        comparison: { model: "Bernoulli NB", modelIdentityHash: baselineModel.modelIdentityHash, policyIdentityHash: baselinePolicy.policyIdentityHash,
          riskScore: nb.fraudProbability, recommendation: nb.verified ? "NO_ADDITIONAL_MODEL_REVIEW" : "REVIEW_RECOMMENDED",
          verified: nb.verified, meaning: "Each model uses its own frozen feature contract on the same snapshot; recorded Oracle outcomes remain authoritative" },
        performance: { inferenceMs, totalAssessmentMs: performance.now() - assessmentStart,
          rssBytes: process.memoryUsage().rss, heapUsedBytes: process.memoryUsage().heapUsed,
          includes: "Total covers archive/root/context and scoring; excludes controller RPC and durable assessment write. Inference is feature-ready scoring/explanation. Memory is process-wide." },
        provenance: bundle.provenance,
        protocolEffect: "NONE: advisory display does not approve, reject, route, vote, reserve or pay a claim",
      };
      return await persist(result) || result;
    })();
    cache.set(assessmentId, task);
    if (cache.size > 32) cache.delete(cache.keys().next().value);
    try { return structuredClone(await task); }
    catch (error) { cache.delete(assessmentId); throw error; }
    finally { inFlight--; }
  };
}

module.exports = { createAdvisoryService, loadAdvisoryBundle, readCommittedRecords };
