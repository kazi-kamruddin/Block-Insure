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
const slitherExecutable = process.env.SLITHER_BIN || "slither";
const sharedEnvironment = {
  ...process.env,
  APPDATA: path.join(projectRoot, ".hardhat-appdata"),
  LOCALAPPDATA: path.join(projectRoot, ".hardhat-localappdata"),
};

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: contractsDirectory,
      env: sharedEnvironment,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

async function main() {
  const compileCode = await run(process.execPath, [hardhatCli, "compile"]);
  if (compileCode !== 0) {
    process.exitCode = compileCode;
    return;
  }

  const slitherArguments = [
    ".",
    "--config-file",
    path.join(contractsDirectory, "slither.config.json"),
    ...process.argv.slice(2),
  ];

  try {
    process.exitCode = await run(slitherExecutable, slitherArguments);
  } catch (error) {
    console.error(
      "Unable to start Slither. Put slither on PATH or set SLITHER_BIN to its executable path."
    );
    console.error(error.message);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
