const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const stages = [
  ["foundation", ["e2e/tests/phase-one-foundation.workflow.spec.js", "e2e/tests/hospital-records.maintenance.spec.js", "e2e/tests/role-workspaces.spec.js", "e2e/tests/route-inventory.spec.js"]],
  ["recovery", ["e2e/tests/phase-two-evidence.workflow.spec.js"]],
  ["evidence", ["e2e/tests/phase-two-evidence.workflow.spec.js"]],
  ["claims", ["e2e/tests/user-policy-claim.workflow.spec.js"]],
  ["refund", ["e2e/tests/cancellation-refund.workflow.spec.js"]],
  ["funding", ["e2e/tests/claim-funding.workflow.spec.js"]],
  ["payments", ["e2e/tests/bank-eft.workflow.spec.js", "e2e/tests/unfinished-boundaries.spec.js"]],
  ["email", ["e2e/tests/email-delivery.workflow.spec.js", "--brevo-stub"]],
  ["finality", ["e2e/tests/unfinished-claim-finality.workflow.spec.js"]],
];
const selected = process.argv[2];
if (process.argv.length > 3 || selected && !stages.some(([name]) => name === selected)) throw new Error("Usage: npm run test:phase2 -- [foundation|recovery|evidence|claims|refund|funding|payments|email|finality]");
let active;
async function main() {
  for (const [name, specs] of stages.filter(([name]) => !selected || selected === name)) {
    console.log(`[Phase 2] ${name}`);
    active = spawn(process.execPath, [path.join(root, "scripts/runStabilizationE2E.js"), ...specs], { cwd: root, stdio: "inherit", windowsHide: true,
      env: { ...process.env, E2E_DATABASE_NAME: process.env.E2E_DATABASE_NAME || "block_insure_phase2_e2e", E2E_UNFUNDED_RESERVE: name === "funding" ? "true" : "false", PHASE_ONE_SETTLEMENT_ONLY: "false", PHASE_ONE_SETTLEMENT_TESTS: "false", PHASE_TWO_RECOVERY_ONLY: name === "recovery" ? "true" : "false" } });
    await new Promise((resolve, reject) => { active.once("error", reject); active.once("close", (code) => code === 0 ? resolve() : reject(new Error(`Phase 2 ${name} exited ${code}`))); });
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
