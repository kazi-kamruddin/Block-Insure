// A bounded, source-bound local release campaign. External acceptance is separate.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { main: snapshot } = require("./prepareReleaseCandidate");
const root = path.resolve(__dirname, "..");
const npm = process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
const unit = (name, directory, script) => ({ name, args: [npm, "--prefix", directory, "run", script] });
const browser = (name, specs, env = {}) => ({ name, args: [path.join(root, "scripts/runStabilizationE2E.js"), ...specs], env });
const STAGES = [
  unit("contracts", "contracts", "test"), unit("stateful", "contracts", "test:stateful"),
  unit("backend", "backEnd", "test"), unit("oracle", "oracle", "test"),
  unit("lint", "frontEnd", "lint"), unit("build", "frontEnd", "build"),
  { name: "synchronization", args: ["scripts/verifySynchronization.js"] },
  { name: "repository", args: ["scripts/verifyRepository.js"] },
  { name: "frontend-production", args: ["node_modules/@playwright/test/cli.js", "test", "--config", "playwright.frontend.config.js"] },
  { name: "storage", args: ["--test", "backEnd/test/stabilizationStorage.integration.js"] },
  browser("readback", ["e2e/tests/phase-two-evidence.workflow.spec.js"], { RELEASE_READBACK_ONLY: "true" }),
  browser("foundation", ["e2e/tests/phase-one-foundation.workflow.spec.js", "e2e/tests/hospital-records.maintenance.spec.js", "e2e/tests/role-workspaces.spec.js", "e2e/tests/route-inventory.spec.js"]),
  browser("evidence", ["e2e/tests/phase-two-evidence.workflow.spec.js"]),
  browser("claims-restart", ["e2e/tests/user-policy-claim.workflow.spec.js", "--shadow-restart"]),
  browser("recovery", ["e2e/tests/phase-two-evidence.workflow.spec.js"], { PHASE_TWO_RECOVERY_ONLY: "true" }),
  browser("settlement", ["e2e/tests/phase-one-foundation.workflow.spec.js"], { PHASE_ONE_SETTLEMENT_ONLY: "true" }),
  browser("payments", ["e2e/tests/bank-eft.workflow.spec.js", "e2e/tests/unfinished-boundaries.spec.js"]),
  browser("email", ["e2e/tests/email-delivery.workflow.spec.js", "--brevo-stub"]),
  browser("refund", ["e2e/tests/cancellation-refund.workflow.spec.js"]),
  browser("funding", ["e2e/tests/claim-funding.workflow.spec.js"], { E2E_UNFUNDED_RESERVE: "true" }),
  browser("finality", ["e2e/tests/unfinished-claim-finality.workflow.spec.js"]),
  browser("security", ["e2e/tests/authentication-security.spec.js", "e2e/tests/resilience-security.spec.js"]),
  browser("rpc", ["e2e/tests/rpc-readiness.resilience.spec.js"], { E2E_RPC_PROXY: "true" }),
  browser("components", ["e2e/tests/release-measurements.workflow.spec.js"]),
  browser("accelerated", ["e2e/tests/accelerated-calendar.workflow.spec.js", "e2e/tests/bank-eft.workflow.spec.js"], { CALENDAR_PROFILE: "ACCELERATED_TESTNET" }),
];
function finalizeReport(report, assertSourceUnchanged) {
  report.localCampaignPassed = false;
  report.sourceUnchangedAfterVerification = false;
  assertSourceUnchanged();
  report.sourceUnchangedAfterVerification = true;
  report.localCampaignPassed = report.results.length === report.plannedStages.length && report.results.every((row) => row.passed);
}
async function main() {
  const args = require("./operatorArguments").parseOperatorArguments(process.argv.slice(2), { values: ["--stage"] });
  if (args["--stage"] && !STAGES.some((stage) => stage.name === args["--stage"])) throw new Error("Unknown release stage");
  if (!process.env.E2E_MONGODB_URI) throw new Error("Select the prepared disposable loopback E2E database explicitly");
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const output = path.join(root, "tmp", `release-${id}`); fs.mkdirSync(output, { recursive: true });
  const sourcePath = `verification-results/release-source-${id}.json`;
  const source = snapshot(["--output", sourcePath]);
  const report = { schema: "block-insure-release-verification-v1", startedAt: new Date().toISOString(), sourcePath, sourceIdentity: source.sourceIdentity,
    plannedStages: STAGES.filter((stage) => !args["--stage"] || stage.name === args["--stage"]).map((stage) => stage.name), results: [],
    localCampaignPassed: false, sourceUnchangedAfterVerification: false,
    externalAcceptance: { actualWalletMailbox: "PENDING", publicTestnets: "PENDING", hostedWorkflows: "PENDING" } };
  console.log(`Release evidence directory: ${path.relative(root, output)}`);
  let active;
  const stop = () => {
    if (active && active.exitCode === null) {
      if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(active.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      else active.kill("SIGTERM");
    }
  };
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { stop(); process.exit(signal === "SIGINT" ? 130 : 143); });
  for (const stage of STAGES.filter((stage) => report.plannedStages.includes(stage.name))) {
    snapshot(["--check", sourcePath]);
    const directory = path.join(output, stage.name); fs.mkdirSync(directory);
    const logfile = path.join(directory, "execution.log"), fd = fs.openSync(logfile, "wx");
    const startedAt = new Date().toISOString(), started = performance.now();
    console.log(`[Release] ${stage.name}`);
    let exitCode;
    try {
      active = spawn(process.execPath, stage.args, { cwd: root, windowsHide: true, stdio: ["ignore", fd, fd], env: { ...process.env,
        E2E_HEADED: "false", CALENDAR_PROFILE: "QUARTERLY", PHASE_ONE_SETTLEMENT_ONLY: "false", PHASE_TWO_RECOVERY_ONLY: "false", RELEASE_READBACK_ONLY: "false", E2E_UNFUNDED_RESERVE: "false", E2E_RPC_PROXY: "false",
        RELEASE_MEASUREMENTS_DIR: directory, PLAYWRIGHT_OUTPUT_DIR: path.join(directory, "browser-artifacts"),
        PLAYWRIGHT_HTML_OUTPUT_DIR: path.join(directory, "browser-report"), PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(directory, "browser-results.json"), ...stage.env } });
      exitCode = await new Promise((resolve, reject) => { active.once("error", reject); active.once("close", resolve); });
    } finally { fs.closeSync(fd); }
    const result = { stage: stage.name, passed: exitCode === 0, exitCode, startedAt, durationMs: performance.now() - started, log: path.relative(root, logfile),
      logSha256: crypto.createHash("sha256").update(fs.readFileSync(logfile)).digest("hex") };
    report.results.push(result);
    report.selectedStagesPassed = report.results.length === report.plannedStages.length && report.results.every((row) => row.passed);
    fs.writeFileSync(path.join(output, "verification.json"), JSON.stringify(report, null, 2) + "\n");
    if (!result.passed) throw new Error(`Release ${stage.name} failed; inspect ${result.log}`);
  }
  try { finalizeReport(report, () => snapshot(["--check", sourcePath])); }
  finally { fs.writeFileSync(path.join(output, "verification.json"), JSON.stringify(report, null, 2) + "\n"); }
  console.log("Selected local release stages passed. External acceptance remains pending.");
}
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { STAGES, finalizeReport };
