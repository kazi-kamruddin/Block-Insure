const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { atomicWriteFileSync } = require("../../backEnd/services/researchArtifactService");

const CONTRACTS_ROOT = path.resolve(__dirname, "..");
const WORKSPACE_ROOT = path.join(CONTRACTS_ROOT, ".mutation-workspace");
const MANIFEST_PATH = path.join(CONTRACTS_ROOT, "mutations", "manifest.json");
const OUTPUT_PATH = process.env.MUTATION_OUTPUT_PATH || path.join(CONTRACTS_ROOT, "mutation-results.json");
const HARDHAT_CLI = path.join(
  CONTRACTS_ROOT,
  "node_modules",
  "hardhat",
  "internal",
  "cli",
  "cli.js"
);

const hardhatEnvironment = () => ({
  ...process.env,
  APPDATA: path.join(CONTRACTS_ROOT, "..", ".hardhat-appdata"),
  LOCALAPPDATA: path.join(CONTRACTS_ROOT, "..", ".hardhat-localappdata"),
  HARDHAT_DISABLE_TELEMETRY: "1",
});

const assertInside = (candidate, root) => {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing path outside mutation workspace: ${candidate}`);
  }
};

const copyProject = (destination) => {
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(path.join(CONTRACTS_ROOT, "contracts"), path.join(destination, "contracts"), {
    recursive: true,
  });
  fs.cpSync(path.join(CONTRACTS_ROOT, "test"), path.join(destination, "test"), {
    recursive: true,
  });
  fs.copyFileSync(
    path.join(CONTRACTS_ROOT, "hardhat.config.js"),
    path.join(destination, "hardhat.config.js")
  );
  fs.copyFileSync(
    path.join(CONTRACTS_ROOT, "package.json"),
    path.join(destination, "package.json")
  );
};

const applyMutation = (workspace, mutation) => {
  const target = path.resolve(workspace, mutation.target);
  assertInside(target, workspace);
  const source = fs.readFileSync(target, "utf8");
  const first = source.indexOf(mutation.search);
  const last = source.lastIndexOf(mutation.search);
  if (first < 0) throw new Error(`${mutation.id}: target snippet not found`);
  if (first !== last) throw new Error(`${mutation.id}: target snippet is not unique`);
  fs.writeFileSync(
    target,
    `${source.slice(0, first)}${mutation.replacement}${source.slice(first + mutation.search.length)}`,
    "utf8"
  );
};

const runMutant = (mutation) => {
  const workspace = path.join(WORKSPACE_ROOT, mutation.id.toLowerCase());
  assertInside(workspace, WORKSPACE_ROOT);
  copyProject(workspace);
  applyMutation(workspace, mutation);
  const startedAt = Date.now();
  const execution = spawnSync(
    process.execPath,
    [HARDHAT_CLI, "test", mutation.testFile, "--grep", mutation.grep],
    {
      cwd: workspace,
      encoding: "utf8",
      timeout: Number(process.env.MUTATION_TIMEOUT_MS || 120000),
      env: hardhatEnvironment(),
    }
  );
  const combinedOutput = `${execution.stdout || ""}\n${execution.stderr || ""}`;
  const compilationFailed = /HH600: Compilation failed|ParserError:|CompilerError:/.test(combinedOutput);
  const infrastructureFailed = /An unexpected error occurred:|MODULE_NOT_FOUND|HH1: You are not inside a Hardhat project/.test(combinedOutput);
  const timedOut = Boolean(execution.error?.code === "ETIMEDOUT");
  return {
    id: mutation.id,
    faultFamily: mutation.faultFamily,
    target: mutation.target,
    testFile: mutation.testFile,
    grep: mutation.grep,
    status: timedOut
      ? "TIMEOUT"
      : infrastructureFailed
        ? "INFRA_ERROR"
      : compilationFailed
        ? "INVALID"
        : execution.status === 0
          ? "SURVIVED"
          : "KILLED",
    exitCode: execution.status,
    durationMs: Date.now() - startedAt,
    outputTail: combinedOutput.trim().split(/\r?\n/).slice(-18),
  };
};

const safelyCleanWorkspace = () => {
  const resolved = path.resolve(WORKSPACE_ROOT);
  assertInside(resolved, CONTRACTS_ROOT);
  if (path.basename(resolved) !== ".mutation-workspace") {
    throw new Error(`Unexpected mutation workspace: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
};

const run = () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const selectedId = process.env.MUTATION_ID?.trim();
  const mutants = selectedId
    ? manifest.mutants.filter((mutation) => mutation.id === selectedId)
    : manifest.mutants;
  if (!mutants.length) throw new Error(`Unknown mutation id: ${selectedId}`);
  const baselineFiles = [...new Set(mutants.map((mutation) => mutation.testFile))];
  const baseline = spawnSync(process.execPath, [HARDHAT_CLI, "test", ...baselineFiles], {
    cwd: CONTRACTS_ROOT,
    encoding: "utf8",
    timeout: 180000,
    env: hardhatEnvironment(),
  });
  if (baseline.status !== 0) {
    throw new Error(
      `Mutation baseline tests failed before mutation:\n${baseline.stdout || ""}\n${baseline.stderr || ""}`
    );
  }
  safelyCleanWorkspace();
  fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
  const results = [];
  try {
    for (const mutation of mutants) {
      const result = runMutant(mutation);
      results.push(result);
      console.log(`${result.status.padEnd(8)} ${result.id} (${result.durationMs} ms)`);
    }
  } finally {
    safelyCleanWorkspace();
  }
  const valid = results.filter((result) => !["INVALID", "TIMEOUT", "INFRA_ERROR"].includes(result.status));
  const killed = valid.filter((result) => result.status === "KILLED").length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    methodology: "isolated source mutation followed by targeted Hardhat regression test",
    mutants: results,
    summary: {
      requested: results.length,
      valid: valid.length,
      killed,
      survived: valid.length - killed,
      invalid: results.filter((result) => result.status === "INVALID").length,
      timedOut: results.filter((result) => result.status === "TIMEOUT").length,
      infrastructureErrors: results.filter((result) => result.status === "INFRA_ERROR").length,
      mutationScore: valid.length ? killed / valid.length : null,
    },
  };
  atomicWriteFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  if (
    report.summary.survived > 0 ||
    report.summary.invalid > 0 ||
    report.summary.timedOut > 0 ||
    report.summary.infrastructureErrors > 0
  ) {
    process.exitCode = 1;
  }
  return report;
};

if (require.main === module) run();

module.exports = {
  applyMutation,
  assertInside,
  run,
  runMutant,
  safelyCleanWorkspace,
};
