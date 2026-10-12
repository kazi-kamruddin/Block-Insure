const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  parseEnv,
  verifyProductionEnvironment,
} = require("./releaseCheck");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const target = args[0];
const envFlagIndex = args.indexOf("--env");
const envPath = path.resolve(
  PROJECT_ROOT,
  envFlagIndex >= 0 ? args[envFlagIndex + 1] : "deploy/production.env"
);

if (!target) {
  throw new Error("A repository-relative Node script path is required");
}
if (envFlagIndex >= 0 && !args[envFlagIndex + 1]) {
  throw new Error("--env requires a file path");
}
if (!fs.existsSync(envPath)) {
  throw new Error(`Deployment environment not found: ${envPath}`);
}

const targetPath = path.resolve(PROJECT_ROOT, target);
if (
  !targetPath.startsWith(`${PROJECT_ROOT}${path.sep}`) ||
  path.extname(targetPath) !== ".js" ||
  !fs.existsSync(targetPath)
) {
  throw new Error(`Refusing to execute an invalid deployment script: ${target}`);
}

const deploymentEnvironment = parseEnv(fs.readFileSync(envPath, "utf8"));
const failures = verifyProductionEnvironment(deploymentEnvironment);
if (failures.length) {
  throw new Error(`Release check failed:\n- ${failures.join("\n- ")}`);
}

const execution = spawnSync(process.execPath, [targetPath], {
  cwd: path.dirname(targetPath),
  env: { ...process.env, ...deploymentEnvironment },
  stdio: "inherit",
});

if (execution.error) throw execution.error;
process.exitCode = execution.status ?? 1;
