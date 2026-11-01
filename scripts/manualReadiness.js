// Read-only manual handoff checks. No service starts, resets, email sends or
// provider credentials in diagnostics. Network checks require --local.
const fs = require("node:fs"), path = require("node:path");
const dotenv = require("../backEnd/node_modules/dotenv");
const { readLocalDeployment } = require("./localDeploymentConfig");
const root = path.resolve(__dirname, "..");
const parseFile = (directory) => {
  const filename = path.join(root, directory, ".env");
  return fs.existsSync(filename) ? dotenv.parse(fs.readFileSync(filename)) : {};
};

function inspectConfiguration(environment, { nodeVersion = process.versions.node } = {}) {
  const rows = [], add = (check, status, next) => rows.push({ check, status, next });
  add("Development Node", Number(nodeVersion.split(".")[0]) === 24 ? "READY" : "ACTION", "Use Node 24 for the complete local stack.");
  let database = "unconfigured";
  try {
    const uri = new URL(environment.MONGODB_URI);
    if (!["mongodb:", "mongodb+srv:"].includes(uri.protocol)) throw new Error("Invalid database protocol");
    database = uri.protocol === "mongodb+srv:" ? "Atlas/SRV" :
      uri.protocol === "mongodb:" && ["localhost", "127.0.0.1", "[::1]"].includes(uri.hostname) ? "loopback" : "external";
  } catch { /* Never include a malformed URI in output. */ }
  add("Database target", database === "unconfigured" ? "ACTION" : "CONFIGURED", `${database}; configuration alone does not establish connectivity. Never reset an unverified target.`);
  let manualTarget = false;
  try { manualTarget = database === "loopback" && new URL(environment.MONGODB_URI).pathname === "/block_insure_manual_dev"; } catch { /* No raw URL diagnostics. */ }
  add("Fresh manual demo target", manualTarget ? "READY" : "MANUAL", "Before a fresh bootstrap, explicitly select loopback block_insure_manual_dev. Daily resume must retain its existing matching database.");
  add("OTP signing", environment.BANK_OTP_SECRET || environment.JWT_SECRET ? "CONFIGURED" : "ACTION",
    environment.BANK_OTP_SECRET ? "Keep the existing secret stable." : environment.JWT_SECRET ? "Existing JWT fallback is configured; a separate stable BANK_OTP_SECRET is optional hardening." : "Configure a stable backend OTP signing secret privately.");
  const mode = environment.OTP_DELIVERY_MODE || (environment.NODE_ENV === "production" ? "disabled" : "simulation");
  const valid = ["simulation", "brevo", "disabled"].includes(mode) && !(mode === "simulation" && environment.NODE_ENV === "production");
  const senderValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(environment.BREVO_SENDER_EMAIL || "");
  add("Email configuration", valid && mode === "brevo" && environment.BREVO_API_KEY?.trim() && senderValid ? "CONFIGURED" : "ACTION",
    !valid ? "Select a valid delivery mode; production simulation is disallowed." : mode === "brevo" ? "Brevo requires a private API key and valid registered sender. Presence does not verify credentials, sender approval or delivery." : "Local simulation/disabled delivery does not test a real mailbox. Complete the Brevo section when ready.");
  add("Real delivery proof", "MANUAL", "Verify the saved profile email and a payment code in your inbox. This check never sends mail.");
  add("Hospital staff access", "MANUAL", "Provision staff in Administration → Hospital Staff, then open /hospital/login without a wallet extension. Hospital wallet grants are retired.");
  return rows;
}

async function inspectLocal({ fetchImpl = global.fetch, deployment = {} } = {}) {
  const rows = [], add = (check, status, next) => rows.push({ check, status, next });
  const probe = async (port, suffix) => {
    try {
      const response = await fetchImpl(`http://127.0.0.1:${port}${suffix}`, { signal: AbortSignal.timeout(2500) });
      return { ok: response.ok, body: await response.json() };
    } catch { return { ok: false }; }
  };
  const services = await Promise.all([5000, 5101, 5102].map((port) => probe(port, "/health/ready")));
  for (let index = 0; index < services.length; index++) {
    const service = services[index], ready = service.ok && service.body?.status === "ready" &&
      (index === 0 ? service.body?.services?.database === "connected" : service.body?.workerEnabled === true && String(service.body?.oracleInstanceId) === String(index));
    add(["Local API/database", "Local Oracle 1", "Local Oracle 2"][index], ready ? "READY" : "ACTION", "Start the verified daily stack; see the handoff guide. No automatic repair was attempted.");
  }
  // Vite commonly binds localhost to IPv6 on Windows, so use its actual host.
  try {
    const response = await fetchImpl("http://localhost:5173", { signal: AbortSignal.timeout(2500) });
    add("Local frontend", response.ok && /Block-Insure/i.test(await response.text()) ? "READY" : "ACTION", "Open http://localhost:5173 in the selected wallet profile.");
  } catch { add("Local frontend", "ACTION", "Start the daily stack; no frontend listener was confirmed."); }
  try {
    const rpc = async (method, params = []) => {
      const response = await fetchImpl("http://127.0.0.1:8545", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(2500) });
      const body = await response.json();
      if (!response.ok || body.error || body.result == null) throw new Error("RPC unavailable");
      return body.result;
    };
    const chain = await rpc("eth_chainId");
    if (BigInt(chain) !== 31337n) throw new Error("Wrong chain");
    const address = deployment.CONTRACT_ADDRESS;
    if (!/^0x[0-9a-f]{40}$/i.test(address || "")) throw new Error("Manifest missing");
    const code = await rpc("eth_getCode", [address, "latest"]);
    add("Local chain/deployment", /^0x[0-9a-f]+$/i.test(code) && !/^0x0*$/i.test(code) ? "READY" : "ACTION", "A running empty Hardhat node is insufficient. npm run dev checks the protocol model identity too.");
  } catch { add("Local chain/deployment", "ACTION", "Start dev:chain; reuse a valid deployment, or deliberately bootstrap only a confirmed disposable database."); }
  return rows;
}

async function main(args = process.argv.slice(2)) {
  if (args.some((arg) => !["--local", "--json"].includes(arg))) throw new Error("Usage: npm run preflight:manual -- [--local] [--json]");
  const environment = { ...parseFile("backEnd"), ...process.env };
  const checks = inspectConfiguration(environment);
  for (const file of ["backEnd/.env", "frontEnd/.env", "contracts/.env", "oracle/.env", "oracle/.env.oracle2"]) {
    checks.push({ check: file, status: fs.existsSync(path.join(root, file)) ? "PRESENT" : "ACTION", next: "Preserve existing values; complete missing configuration from its example privately." });
  }
  for (const directory of ["node_modules/@playwright/test", "backEnd/node_modules/ethers", "frontEnd/node_modules/vite", "contracts/node_modules/hardhat", "oracle/node_modules/axios"]) {
    checks.push({ check: directory, status: fs.existsSync(path.join(root, directory)) ? "PRESENT" : "ACTION", next: "Install dependencies only if absent; this command never installs packages." });
  }
  let deployment = {};
  try {
    deployment = readLocalDeployment(root);
    checks.push({ check: "Local deployment manifest", status: deployment.CONTRACT_ADDRESS ? "PRESENT" : "ACTION", next: "Saved addresses do not prove the in-memory chain still exists." });
  } catch { checks.push({ check: "Local deployment manifest", status: "ACTION", next: "Manifest is missing or invalid. Review it without changing secrets or resetting data." }); }
  if (args.includes("--local")) checks.push(...await inspectLocal({ deployment }));
  const report = { scope: args.includes("--local") ? "Configuration plus bounded loopback probes" : "Offline configuration only; no network requests", checks,
    actions: checks.filter((row) => row.status === "ACTION").length, guide: "docs/local-development.md",
    boundary: "READY/CONFIGURED is not full workflow or real-delivery proof. No service startup, database write/reset, email send or hosted activation." };
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else { console.table(checks); console.log(`${report.actions} configuration/runtime actions remain. Read ${report.guide}.\n${report.boundary}`); }
  return report;
}
if (require.main === module) main().catch(() => { console.error("Manual readiness check could not complete. Check dependencies and command flags; no repair was attempted."); process.exitCode = 1; });
module.exports = { inspectConfiguration, inspectLocal, main };
