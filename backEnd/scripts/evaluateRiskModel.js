// Compatibility entry point. Phase 5 supersedes the legacy random record split.
const { run } = require("./evaluatePhase5");

const runEvaluation = ({ writeOutputs = true } = {}) => {
  const summary = run({ writeOutput: writeOutputs });
  return { summary, records: [] };
};

if (require.main === module) {
  const result = runEvaluation();
  console.log(`Phase 5 grouped/temporal evaluation complete: ${result.summary.runtimeModel.artifactHash}`);
}

module.exports = { runEvaluation };
