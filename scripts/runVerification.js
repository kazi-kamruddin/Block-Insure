const { spawnSync } = require("node:child_process");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { atomicWriteFileSync } = require("../backEnd/services/researchArtifactService");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.join(PROJECT_ROOT, "verification-results", "phase5-verification.json");
const npmCli = process.env.npm_execpath || path.join(
  path.dirname(process.execPath),
  "node_modules",
  "npm",
  "bin",
  "npm-cli.js"
);
const includeRuntime = process.argv.includes("--runtime");

const git = (...args) => execFileSync(
  "git",
  ["-c", `safe.directory=${PROJECT_ROOT.replace(/\\/g, "/")}`, ...args],
  { cwd: PROJECT_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
).trim();

const tasks = [
  { key: "contracts", command: process.execPath, args: [npmCli, "--prefix", "contracts", "test"] },
  { key: "repository_integrity", command: process.execPath, args: ["scripts/verifyRepository.js"] },
  { key: "backend", command: process.execPath, args: [npmCli, "--prefix", "backEnd", "test"] },
  { key: "frontend_lint", command: process.execPath, args: [npmCli, "--prefix", "frontEnd", "run", "lint"] },
  { key: "frontend_build", command: process.execPath, args: [npmCli, "--prefix", "frontEnd", "run", "build"] },
  { key: "oracle", command: process.execPath, args: [npmCli, "--prefix", "oracle", "test"] },
  ...(includeRuntime
    ? [{ key: "runtime_synchronization", command: process.execPath, args: [npmCli, "run", "verify:sync"] }]
    : []),
];

const run = () => {
  const results = [];
  for (const task of tasks) {
    const startedAt = Date.now();
    console.log(`\n[Verification] Starting ${task.key}...`);
    const execution = spawnSync(task.command, task.args, {
      cwd: PROJECT_ROOT,
      env: process.env,
      stdio: "inherit",
    });
    const passed = execution.status === 0 && !execution.error;
    results.push({
      key: task.key,
      passed,
      exitCode: execution.status,
      durationMs: Date.now() - startedAt,
      error: execution.error?.message || null,
    });
  }
  const report = {
    schemaVersion: 5,
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    source: {
      gitCommit: git("rev-parse", "HEAD"),
      branch: git("rev-parse", "--abbrev-ref", "HEAD"),
      dirty: Boolean(git("status", "--porcelain")),
    },
    runtimeSynchronizationIncluded: includeRuntime,
    passed: results.every((result) => result.passed),
    tasks: results,
  };
  atomicWriteFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n[Verification] Report written to ${OUTPUT_PATH}`);
  if (!report.passed) process.exitCode = 1;
  return report;
};

if (require.main === module) run();

module.exports = { run };
