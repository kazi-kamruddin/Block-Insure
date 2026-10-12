const { spawn } = require("node:child_process");
const path = require("node:path");

const contractsDirectory = path.resolve(__dirname, "..");
const projectRoot = path.resolve(contractsDirectory, "..");
const hardhatCli = path.join(
  contractsDirectory,
  "node_modules",
  "hardhat",
  "internal",
  "cli",
  "cli.js"
);

const child = spawn(process.execPath, [hardhatCli, ...process.argv.slice(2)], {
  cwd: contractsDirectory,
  env: {
    ...process.env,
    APPDATA: path.join(projectRoot, ".hardhat-appdata"),
    LOCALAPPDATA: path.join(projectRoot, ".hardhat-localappdata"),
  },
  stdio: "inherit",
});

child.once("error", (error) => {
  console.error("Unable to start Hardhat:", error.message);
  process.exitCode = 1;
});

// On Windows, the process "exit" event can fire before inherited stdio handles
// have closed. Waiting for "close" avoids a libuv teardown race on newer Node
// releases when Hardhat is nested under the managed launcher.
child.once("close", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
