const path = require("node:path");
const { performance } = require("node:perf_hooks");
const MockHospitalRecord = require("../models/MockHospitalRecord");
const {
  buildMerkleTree,
  getProofPath,
  verifyMerkleProof,
} = require("../services/merkleRegistryService");
const {
  atomicWriteFileSync,
  calculateReproducibilityHash,
} = require("../services/researchArtifactService");
const { loadHybridManifest } = require("../services/hybridDatasetIntegrityService");
const { buildHybridRuntimeRecords } = require("./seedHybridData");

const OUTPUT_PATH = path.join(
  __dirname,
  "..",
  "evaluation-results",
  "hybrid-runtime-benchmark.json"
);

const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length;

const run = async ({ proofSamples = 100, writeOutput = true } = {}) => {
  const manifest = loadHybridManifest();
  const records = (await buildHybridRuntimeRecords()).map((record) =>
    new MockHospitalRecord(record).toObject({ versionKey: false })
  );
  const heapBefore = process.memoryUsage().heapUsed;
  const buildStarted = performance.now();
  const tree = buildMerkleTree(records);
  const coldTreeBuildMs = performance.now() - buildStarted;
  const sampleCount = Math.min(proofSamples, tree.leaves.length);
  const proofBuildTimes = [];
  const proofVerificationTimes = [];
  let verifiedProofs = 0;

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const leafIndex = Math.floor((sample * tree.leaves.length) / sampleCount);
    const leaf = tree.leaves[leafIndex];
    const proofStarted = performance.now();
    const proof = getProofPath(tree.levels, leafIndex);
    proofBuildTimes.push(performance.now() - proofStarted);
    const verifyStarted = performance.now();
    verifiedProofs += Number(verifyMerkleProof({
      leafHash: leaf.leafHash,
      proof,
      rootHash: tree.rootHash,
    }));
    proofVerificationTimes.push(performance.now() - verifyStarted);
  }

  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    datasetVersion: manifest.datasetVersion,
    runtimeRecords: records.length,
    hybridRecords: manifest.counts.runtimeHybrid,
    preservedDemoRecords: records.length - manifest.counts.runtimeHybrid,
    tree: {
      version: tree.treeVersion,
      rootHash: tree.rootHash,
      leafCount: tree.leafCount,
      depth: tree.treeDepth,
      cachedRuntimeBehavior: "One tree per immutable registry snapshot; proof lookup uses an invoice-hash index",
    },
    proofSample: {
      requested: proofSamples,
      tested: sampleCount,
      verified: verifiedProofs,
      allValid: verifiedProofs === sampleCount,
    },
    performance: {
      coldTreeBuildMs,
      meanProofBuildMs: mean(proofBuildTimes),
      meanProofVerificationMs: mean(proofVerificationTimes),
      heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
      interpretation: "Descriptive local measurement; excluded from the reproducibility hash",
    },
  };
  result.reproducibilityHash = calculateReproducibilityHash(result);
  if (!result.proofSample.allValid) throw new Error("One or more sampled Merkle proofs failed");
  if (writeOutput) atomicWriteFileSync(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`);
  return result;
};

if (require.main === module) {
  run()
    .then((result) => {
      console.log(`Hybrid runtime benchmark written to ${OUTPUT_PATH}`);
      console.log(`Merkle leaves: ${result.tree.leafCount}`);
      console.log(`Sampled proofs verified: ${result.proofSample.verified}/${result.proofSample.tested}`);
    })
    .catch((error) => {
      console.error("Hybrid runtime benchmark failed:", error);
      process.exitCode = 1;
    });
}

module.exports = { run };
