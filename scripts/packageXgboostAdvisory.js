// Explicit local packaging; never retrains, activates Oracles or changes .env.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const names = ["backEnd/artifacts/xgboost-advisory-v1.json", "oracle/xgboostAssessment.js", "oracle/observableFeatures.js",
  "oracle/independentAssessment.js", "backEnd/research/context.js", "backEnd/research/phase3-plan.json",
  "backEnd/services/continuousFeatureService.js", "backEnd/services/advisoryContextService.js",
  "backEnd/model-params.json", "backEnd/triage-policy.json"];
const manifest = { version: "xgboost-admin-manifest-v1", authority: "ADMIN_ADVISORY_ONLY",
  files: Object.fromEntries(names.map((name) => [name, crypto.createHash("sha256").update(fs.readFileSync(path.join(root, name))).digest("hex")])),
  note: "Integrity/provenance checks, not a signature or an assertion of clinical truth" };
const target = path.join(root, "backEnd/artifacts/xgboost-advisory-manifest.json");
const bytes = JSON.stringify(manifest, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (fs.readFileSync(target, "utf8") !== bytes) throw new Error("Advisory packaging is stale; explicitly review/repackage changed inputs");
  console.log("Advisory bundle and observable source identities verified");
} else {
  fs.writeFileSync(target, bytes);
  console.log("Packaged default Admin advisory manifest; Oracle protocol unchanged");
}
