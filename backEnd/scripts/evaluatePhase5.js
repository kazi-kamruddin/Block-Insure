const fs = require("node:fs");
const path = require("node:path");
const { generateAllSyntheticDatasets } = require("../services/syntheticRegistryService");
const { runLeakageSafeEvaluation } = require("../services/phase5EvaluationService");
const { verifyModelArtifact } = require("../services/modelArtifactService");
const modelArtifact = require("../model-params.json");
const { predictBernoulliNaiveBayes } = require("../services/bernoulliNaiveBayesService");
const { extractRecordFeatures } = require("../services/featureEngineeringService");
const { calibrateProbability } = require("../services/calibrationService");
const { performance } = require("node:perf_hooks");
const {
  buildConsistencyProof,
  buildInclusionProof,
  canonicalize,
  hashLeaf,
  merkleTreeHash,
  verifyConsistencyProof,
  verifyInclusionProof,
} = require("../services/evidenceTransparencyService");

const OUTPUT_PATH = path.join(__dirname, "..", "evaluation-results", "phase5-evaluation.json");

const benchmarkEvidenceProofs = () => {
  const leaves = Array.from({ length: 512 }, (_, index) => hashLeaf(canonicalize({ index, event: "PHASE5_BENCHMARK" })));
  const startedAt = performance.now();
  const rootHash = merkleTreeHash(leaves);
  const inclusionProof = buildInclusionProof(leaves, 255);
  const oldSize = 256;
  const oldRoot = merkleTreeHash(leaves.slice(0, oldSize));
  const consistencyProof = buildConsistencyProof(leaves, oldSize);
  const elapsedMs = performance.now() - startedAt;
  return {
    treeSize: leaves.length,
    buildAndProveMs: elapsedMs,
    inclusionProofNodes: inclusionProof.length,
    inclusionProofBytes: inclusionProof.length * 32,
    consistencyProofNodes: consistencyProof.length,
    consistencyProofBytes: consistencyProof.length * 32,
    inclusionVerified: verifyInclusionProof({ leafHash: leaves[255], leafIndex: 255, treeSize: leaves.length, proof: inclusionProof, rootHash }),
    consistencyVerified: verifyConsistencyProof({ oldSize, newSize: leaves.length, oldRoot, newRoot: rootHash, proof: consistencyProof }),
  };
};

const run = ({ writeOutput = true, size = 600 } = {}) => {
  const runtimeArtifact = verifyModelArtifact(modelArtifact);
  if (!runtimeArtifact.valid) throw new Error(runtimeArtifact.errors.join("; "));
  const datasets = generateAllSyntheticDatasets({ seed: 202605, size });
  const datasetResults = Object.fromEntries(Object.entries(datasets).map(([profile, records]) => [
    profile,
    runLeakageSafeEvaluation(records),
  ]));
  const probabilityBins = Array.from({ length: 5 }, (_, index) => ({
    range: `${index * 20}-${(index + 1) * 20}%`,
    min: index * 0.2,
    max: (index + 1) * 0.2,
    count: 0,
  }));
  for (const record of datasets.normal) {
    const raw = predictBernoulliNaiveBayes(modelArtifact, extractRecordFeatures(record));
    const probability = calibrateProbability(raw.fraudProbability, modelArtifact.calibration);
    const index = Math.min(Math.floor(probability * 5), 4);
    probabilityBins[index].count += 1;
  }
  const result = {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    runtimeModel: {
      modelVersion: modelArtifact.modelVersion,
      artifactHash: modelArtifact.artifactHash,
      modelIdentityHash: modelArtifact.modelIdentityHash,
      evaluatedArtifactHash: runtimeArtifact.expectedArtifactHash,
      hashesMatch: modelArtifact.artifactHash === runtimeArtifact.expectedArtifactHash,
    },
    datasets: datasetResults,
    confidenceIntervals: datasetResults.normal.confidenceIntervals,
    metrics: {
      accuracy: datasetResults.normal.confidenceIntervals.accuracy.mean,
      precision: datasetResults.normal.confidenceIntervals.precision.mean,
      recall: datasetResults.normal.confidenceIntervals.recall.mean,
      f1Score: datasetResults.normal.confidenceIntervals.f1Score.mean,
      auc: datasetResults.normal.confidenceIntervals.rocAuc.mean,
      averagePrecision: datasetResults.normal.confidenceIntervals.prAuc.mean,
      brierScore: datasetResults.normal.confidenceIntervals.brierScore.mean,
      calibrationError: datasetResults.normal.confidenceIntervals.calibrationError.mean,
    },
    decisionRule: {
      selectedThreshold: modelArtifact.threshold,
      terminology: "fraudProbability >= threshold; verificationConfidence is a separate on-chain structural score",
    },
    dataset: {
      profiles: Object.keys(datasets),
      recordsPerProfile: size,
      primaryProfile: "normal",
    },
    baselines: [],
    temporalHoldout: datasetResults.temporal_distribution_shift.temporalHoldout,
    performance: datasetResults.normal.performance,
    fraudProbabilityDistribution: probabilityBins,
    attackMetrics: {
      fuzzyDuplicateAutomaticRejectionRate: 0,
      groupLeakageDetections: datasetResults.normal.evaluations.filter((item) => !item.leakage.valid).length,
    },
    evidenceProofCosts: benchmarkEvidenceProofs(),
  };
  if (writeOutput) {
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  return result;
};

if (require.main === module) {
  const result = run();
  console.log(`Phase 5 evaluation written to ${OUTPUT_PATH}`);
  console.log(`Runtime/evaluated hashes match: ${result.runtimeModel.hashesMatch}`);
}

module.exports = { run };
