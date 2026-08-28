const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { atomicWriteFileSync } = require("../services/researchArtifactService");

const CHART_DIRECTORY = path.join(__dirname, "..", "evaluation-results", "evaluation-charts");
const OUTPUT_PATH = path.join(CHART_DIRECTORY, "chart-manifest.json");

const sha256File = (filePath) =>
  crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

const run = ({ writeOutput = true } = {}) => {
  if (!fs.existsSync(CHART_DIRECTORY)) throw new Error("Evaluation chart directory is missing");
  const charts = fs.readdirSync(CHART_DIRECTORY)
    .filter((fileName) => /\.(png|svg)$/i.test(fileName))
    .sort()
    .map((fileName) => {
      const filePath = path.join(CHART_DIRECTORY, fileName);
      return {
        file: fileName,
        format: path.extname(fileName).slice(1).toLowerCase(),
        bytes: fs.statSync(filePath).size,
        sha256: sha256File(filePath),
      };
    });
  if (!charts.length) throw new Error("No generated evaluation charts were found");
  const manifest = { schemaVersion: 1, generatedAt: new Date().toISOString(), charts };
  if (writeOutput) atomicWriteFileSync(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
};

if (require.main === module) {
  const manifest = run();
  console.log(`Chart manifest written with ${manifest.charts.length} files`);
}

module.exports = { CHART_DIRECTORY, OUTPUT_PATH, run, sha256File };
