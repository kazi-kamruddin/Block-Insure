const path = require("node:path");
const { atomicWriteFileSync, calculateReproducibilityHash } = require("../services/researchArtifactService");
const { evaluateReserveAdequacy } = require("../services/reserveSimulationService");

const OUTPUT_PATH = path.join(__dirname, "..", "evaluation-results", "phase3-reserve-evaluation.json");

const run = ({ writeOutput = true } = {}) => {
  const result = {
    ...evaluateReserveAdequacy(),
    generatedAt: new Date().toISOString(),
  };
  result.reproducibilityHash = calculateReproducibilityHash(result);
  if (writeOutput) {
    atomicWriteFileSync(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`);
  }
  return result;
};

if (require.main === module) {
  const result = run();
  console.log(`Reserve evaluation written to ${OUTPUT_PATH}`);
  console.log(`Reproducibility hash: ${result.reproducibilityHash}`);
}

module.exports = { run };
