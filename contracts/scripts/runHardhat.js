const { spawn } = require("child_process");
const path = require("path");

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

child.on("error", (error) => {
  console.error("Unable to start Hardhat:", error.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
