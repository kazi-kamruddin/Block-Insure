const { spawnSync } = require("node:child_process");
const path = require("node:path");

const contractsDirectory = path.resolve(__dirname, "..");
const runner = path.join(__dirname, "runHardhat.js");

function runHardhat(args) {
  return spawnSync(process.execPath, [runner, ...args], {
    cwd: contractsDirectory,
    env: process.env,
    stdio: "inherit",
  });
}

const coverage = runHardhat(["coverage"]);

// solidity-coverage deliberately writes instrumented build artifacts. Restore
// the normal artifacts before returning so later ABI, bytecode-size, deploy, or
// synchronization checks cannot depend on suite execution order.
const restore = runHardhat(["compile", "--force"]);

if (restore.error) {
  console.error("Unable to restore normal contract artifacts:", restore.error.message);
}

process.exitCode =
  coverage.error || coverage.status !== 0 || restore.error || restore.status !== 0
    ? 1
    : 0;
