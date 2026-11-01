const path = require("node:path");
const fs = require("node:fs");
const { run } = require("./evaluateObservablePipeline");
const { atomicWriteFileSync } = require("../services/researchArtifactService");
async function main() {
  const root = path.resolve(__dirname, "../..");
  const datasetRoot = path.resolve(process.env.OBSERVABLE_DATASET_DIR || path.join(root, "docs/engineered/observable-2026-10-23T19-34-11-717Z"));
  if (!fs.existsSync(path.join(datasetRoot, "manifest.json"))) throw new Error("Prepare a versioned observable dataset and set OBSERVABLE_DATASET_DIR");
  const studyRoot = path.join(root, "docs/engineered", `observable-study-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const reports = [];
  for (const seed of [11, 29, 47]) for (const includeHistory of [false, true]) {
    const outputRoot = path.join(studyRoot, `seed-${seed}-${includeHistory ? "history" : "baseline"}`);
    const result = await run({ datasetRoot, outputRoot, sampleSeed: seed, sampleSize: 2000, includeHistory });
    reports.push({ seed, includeHistory, evaluation: path.relative(root, path.join(result.directory, "evaluation.json")).replaceAll("\\", "/"),
      methods: result.report.methods, uncertainty: result.report.uncertainty, selectedOperatingPoints: result.report.selectedOperatingPoints, sourceSha256: result.report.sourceSha256 });
    global.gc?.();
  }
  const summary = { generatedAt: new Date().toISOString(), runs: reports,
    interpretation: "Three sampling seeds on one fixed source partition/scenario generation; not three independent datasets. Compare history on/off within seed; do not select a winner from test F1.",
    promotionDecision: "HOLD: history is offline advisory, not proof-bound worker input. Do not replace active artifacts from this study.",
    nextDecision: "Use validation-cost/whole-score-budget results and clustered uncertainty, not the largest test score, to choose a prospective follow-up." };
  atomicWriteFileSync(path.join(studyRoot, "study-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Study complete: ${path.relative(root, studyRoot)}`);
}
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
