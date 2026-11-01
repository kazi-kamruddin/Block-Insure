// Serial disposable deployments keep premium time travel out of claim fixtures.
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const stages = [
  ["foundation", ["e2e/tests/phase-one-foundation.workflow.spec.js", "e2e/tests/hospital-records.maintenance.spec.js", "e2e/tests/role-workspaces.spec.js"]],
  ["payments", ["e2e/tests/bank-eft.workflow.spec.js", "e2e/tests/unfinished-boundaries.spec.js"]],
  ["claims", ["e2e/tests/user-policy-claim.workflow.spec.js"]],
  ["email", ["e2e/tests/email-delivery.workflow.spec.js", "--brevo-stub"]],
  ["settlement", ["e2e/tests/phase-one-foundation.workflow.spec.js"]],
];
const selected = process.argv[2];
if (process.argv.length > 3 || selected && !stages.some(([name]) => name === selected)) {
  throw new Error("Usage: npm run test:phase1 -- [foundation|payments|claims|email|settlement]");
}
const environment = { ...process.env, E2E_DATABASE_NAME: process.env.E2E_DATABASE_NAME || "block_insure_phase1_e2e",
  PHASE_ONE_SETTLEMENT_TESTS: "false", PHASE_ONE_SETTLEMENT_ONLY: "false" };
let active;
async function main() {
  for (const [name, specs] of stages.filter(([name]) => !selected || name === selected)) {
    console.log(`[Phase 1] ${name}`);
    active = spawn(process.execPath, [path.join(root, "scripts/runStabilizationE2E.js"), ...specs], {
      cwd: root, env: { ...environment, PHASE_ONE_SETTLEMENT_ONLY: name === "settlement" ? "true" : "false" },
      stdio: "inherit", windowsHide: true,
    });
    await new Promise((resolve, reject) => {
      active.once("error", reject);
      active.once("close", (code) => code === 0 ? resolve() : reject(new Error(`Phase 1 ${name} exited ${code}`)));
    });
  }
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
  if (active && active.exitCode === null) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(active.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else active.kill(signal);
  }
  process.exit(signal === "SIGINT" ? 130 : 143);
});
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
