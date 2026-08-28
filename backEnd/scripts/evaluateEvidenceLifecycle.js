const path = require("node:path");
const { atomicWriteFileSync, calculateReproducibilityHash } = require("../services/researchArtifactService");
const { evaluateEvidenceLifecycle } = require("../services/evidenceBenchmarkService");

const OUTPUT_PATH = path.join(__dirname, "..", "evaluation-results", "phase4-evidence-evaluation.json");

const reproducibilityBasis = (result) => ({
  schemaVersion: result.schemaVersion,
  methodology: result.methodology,
  documents: result.documentBenchmarks.map(({ key, mediaType, bytes, ciphertextBytes }) => ({
    key,
    mediaType,
    bytes,
    ciphertextBytes,
  })),
  recipients: result.preBenchmarks.map(({ recipientCount, capsuleBytes }) => ({ recipientCount, capsuleBytes })),
  identityLifecycle: {
    keyRotationImplemented: Boolean(result.identityLifecycle?.keyRotation),
    revocationAuthorizationCheckImplemented: Boolean(result.identityLifecycle?.revocationAuthorizationCheck),
    staleGrantAuthorizationCheckImplemented: Boolean(result.identityLifecycle?.staleGrantAuthorizationCheck),
  },
  proofs: result.proofBenchmarks.map(({ treeSize, proofNodes, proofBytes }) => ({ treeSize, proofNodes, proofBytes })),
  adversarialTests: result.adversarialTests,
  authorityBoundary: result.authorityBoundary,
  limitations: result.limitations,
});

const run = ({ writeOutput = true, repetitions = 30 } = {}) => {
  const result = {
    ...evaluateEvidenceLifecycle({ repetitions }),
    generatedAt: new Date().toISOString(),
  };
  result.reproducibilityHash = calculateReproducibilityHash(reproducibilityBasis(result));
  if (writeOutput) {
    atomicWriteFileSync(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`);
  }
  return result;
};

if (require.main === module) {
  const result = run();
  console.log(`Evidence evaluation written to ${OUTPUT_PATH}`);
  console.log(`Adversarial detection: ${result.adversarialTests.detected}/${result.adversarialTests.total}`);
}

module.exports = { reproducibilityBasis, run };
