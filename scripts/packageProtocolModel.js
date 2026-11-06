// Explicit offline artifact publication only. Never changes on-chain defaults.
const fs = require("node:fs"), path = require("node:path");
const { buildProtocolArtifact } = require("../oracle/runtimeProtocol");
const target = path.resolve(__dirname, "../backEnd/artifacts/xgboost-protocol-v5.json");
const bytes = JSON.stringify(buildProtocolArtifact(), null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (fs.readFileSync(target, "utf8") !== bytes) throw new Error("Protocol artifact is stale; review and repackage explicitly");
  console.log("XGBoost protocol identity and source bindings verified");
} else { fs.writeFileSync(target, bytes); console.log("Prepared XGBoost protocol artifact; no on-chain identity changed"); }
