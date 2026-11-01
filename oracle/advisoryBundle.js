// Shared immutable loader: no backend dependencies, database or network access.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { compile } = require("./xgboostAssessment");
const root = path.resolve(__dirname, "..");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
let loaded;
function loadAdvisoryBundle() {
  if (loaded) return loaded;
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "backEnd/artifacts/xgboost-advisory-manifest.json"), "utf8"));
  for (const [name, expected] of Object.entries(manifest.files)) {
    const resolved = path.resolve(root, name);
    if (!resolved.startsWith(root + path.sep) || hash(fs.readFileSync(resolved)) !== expected) throw new Error("Advisory artifact/source identity mismatch");
  }
  const bytes = fs.readFileSync(path.join(root, "backEnd/artifacts/xgboost-advisory-v1.json"));
  const bundle = JSON.parse(bytes);
  loaded = { bundle, engine: compile(bundle), bundleHash: hash(bytes), manifestHash: hash(JSON.stringify(manifest)) };
  return loaded;
}
module.exports = { loadAdvisoryBundle };
