const fs = require("node:fs");
const path = require("node:path");
const { generateAllSyntheticDatasets } = require("../services/syntheticRegistryService");
const { canonicalize } = require("../services/modelArtifactService");
const crypto = require("node:crypto");

const OUTPUT_DIR = path.join(__dirname, "..", "datasets", "phase5");

const run = ({ seed = 202605, size = 600 } = {}) => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const datasets = generateAllSyntheticDatasets({ seed, size });
  const manifest = { schemaVersion: 1, seed, datasets: {} };
  for (const [profile, records] of Object.entries(datasets)) {
    const contents = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
    const fileName = `${profile}.jsonl`;
    fs.writeFileSync(path.join(OUTPUT_DIR, fileName), contents, "utf8");
    manifest.datasets[profile] = {
      file: fileName,
      records: records.length,
      fraudRecords: records.filter((record) => record.actualFraud).length,
      sha256: crypto.createHash("sha256").update(contents).digest("hex"),
    };
  }
  manifest.manifestHash = crypto.createHash("sha256").update(canonicalize(manifest)).digest("hex");
  fs.writeFileSync(path.join(OUTPUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
};

if (require.main === module) console.log(JSON.stringify(run(), null, 2));

module.exports = { run };
