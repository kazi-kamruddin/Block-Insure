// Isolated regression stack: no saved .env files or normal deployment manifests
// are rewritten. Invoke through runIsolatedE2E.js to supply development actors.
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const children = [];
fs.mkdirSync(path.join(root, "tmp"), { recursive: true });
const output = fs.mkdtempSync(path.join(root, "tmp", "stabilization-"));
const environment = {
  ...process.env, NODE_ENV: "development", FORCE_PUBLIC_DNS: "false",
  BLOCKCHAIN_RUNTIME_ENABLED: "true", INDEXER_ENABLED: "true", INDEXER_CONFIRMATIONS: "0",
  ORACLE_WORKER_ENABLED: "true", ORACLE_CURSOR_MODE: "backend", ORACLE_POLL_INTERVAL_MS: "1000",
  PORT: "5000", RPC_URL: "http://127.0.0.1:8545", CHAIN_ID: "31337",
  JWT_SECRET: crypto.randomBytes(32).toString("hex"), BANK_OTP_SECRET: crypto.randomBytes(32).toString("hex"),
  ORACLE_API_KEY: crypto.randomBytes(32).toString("hex"),
  ALLOWED_ORIGINS: "http://localhost:5173,http://127.0.0.1:5173", SIWE_URI: "http://localhost:5173", SIWE_DOMAIN: "localhost:5173",
  VITE_API_BASE_URL: "http://localhost:5000", VITE_IPFS_GATEWAY: "http://127.0.0.1:5055/ipfs/",
  PINATA_API_BASE_URL: "http://127.0.0.1:5055", PINATA_JWT: "block-insure-local-test-only-token",
  LOCAL_PINATA_PORT: "5055", EVIDENCE_KEY_DIRECTORY: path.join(output, "keys"),
  DEPLOY_WRITE_ENV: "false", DEPLOYMENT_OUTPUT_DIR: output,
  SKIP_LOCAL_ORACLE_CURSOR_RESET: "true",
  APPDATA: path.join(root, ".hardhat-appdata"), LOCALAPPDATA: path.join(root, ".hardhat-localappdata"),
};
const database = new URL(environment.MONGODB_URI);
if (!["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) || database.pathname !== "/block_insure_e2e") {
  throw new Error("Stabilization stack requires disposable loopback block_insure_e2e");
}
function start(label, file, args = [], cwd = root, extra = {}) {
  console.log(`[Stabilization] ${label}`);
  const child = spawn(process.execPath, [file, ...args], { cwd, env: { ...environment, ...extra }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let diagnostic = "";
  const capture = (chunk) => {
    const safe = chunk.toString().split(/\r?\n/).filter((line) => !/private.?key|secret|mnemonic|seed phrase|0x[a-fA-F0-9]{64}/i.test(line)).join("\n");
    diagnostic = (diagnostic + safe).slice(-8000);
    if (label === "Browser regression") process.stdout.write(safe);
  };
  child.stdout.on("data", capture); child.stderr.on("data", capture);
  child.completed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`${label} exited ${code}: ${diagnostic}`)));
  });
  child.completed.catch(() => {});
  return child;
}
const run = async (...args) => start(...args).completed;
const hardhat = (script) => run(script, path.join(root, "contracts/node_modules/hardhat/internal/cli/cli.js"), ["run", script, "--network", "localhost"], path.join(root, "contracts"));
const backend = (script, args = []) => run(script, path.join(root, "backEnd/scripts", script), args, path.join(root, "backEnd"));
async function waitFor(check, label) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch { /* wait for local service */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not become ready`);
}
async function cleanup() {
  for (const child of [...children].reverse()) {
    if (child.exitCode !== null) continue;
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    else child.kill("SIGTERM");
  }
}
async function main() {
  if (process.argv.length === 2) {
    // Time-travel scenarios require independent deployments, not merely fresh
    // browser contexts. Never let maturity/expiry poison a later claim fixture.
    const campaign = [
      ["e2e/tests/user-policy-claim.workflow.spec.js"],
      ["e2e/tests/bank-eft.workflow.spec.js"],
      ["e2e/tests/hospital-records.maintenance.spec.js"],
      ["e2e/tests/unfinished-benefits.workflow.spec.js"],
      ["e2e/tests/unfinished-boundaries.spec.js"],
      ...["simultaneous rejection", "expired review", "encrypted corrected appeal"].map((grep) => ["e2e/tests/unfinished-claim-finality.workflow.spec.js", "--grep", grep]),
    ];
    for (const selection of campaign) {
      await run("Browser regression", __filename, selection);
      console.log(`\n[Stabilization] Passed: ${selection.join(" ")}`);
    }
    return;
  }
  // Refuse to attach to someone else's blockchain.
  try { const response = await fetch(environment.RPC_URL, { signal: AbortSignal.timeout(1000) }); if (response) throw new Error("RPC port is occupied"); } catch (error) { if (error.message === "RPC port is occupied") throw error; }
  start("Hardhat", path.join(root, "contracts/node_modules/hardhat/internal/cli/cli.js"), ["node", "--hostname", "127.0.0.1"], path.join(root, "contracts"));
  await waitFor(async () => (await fetch(environment.RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) })).ok, "Hardhat");
  await backend("resetLocalData.js", ["--yes", "--hybrid"]);
  await hardhat("scripts/fund-demo-accounts-local.js");
  await hardhat("scripts/deploy.js");
  const deployment = JSON.parse(fs.readFileSync(path.join(output, "localhost-31337.json")));
  for (const [component, key] of Object.entries({ InsuranceManager: "CONTRACT_ADDRESS", ClaimAdjudicator: "CLAIM_ADJUDICATOR_ADDRESS", PolicyEconomics: "POLICY_ECONOMICS_ADDRESS", PolicyBenefitsManager: "POLICY_BENEFITS_ADDRESS", EvidenceRegistry: "EVIDENCE_REGISTRY_ADDRESS", HospitalVerificationRegistry: "HOSPITAL_VERIFICATION_REGISTRY_ADDRESS", BankIdentityRegistry: "BANK_IDENTITY_REGISTRY_ADDRESS", ProtocolDeploymentRegistry: "PROTOCOL_DEPLOYMENT_REGISTRY_ADDRESS" })) {
    environment[key] = deployment.components[component];
    environment[`VITE_${key}`] = deployment.components[component];
  }
  environment.CONTRACT_DEPLOYMENT_BLOCK = String(deployment.deploymentBlock);
  environment.VITE_DEPLOYMENT_BLOCK = String(deployment.deploymentBlock);
  environment.POLICY_BENEFITS_DEPLOYMENT_BLOCK = String(deployment.benefitsDeploymentBlock);
  environment.VITE_POLICY_BENEFITS_DEPLOYMENT_BLOCK = String(deployment.benefitsDeploymentBlock);
  await backend("grantProjectRolesLocal.js");
  await backend("fundContractLocal.js", ["5"]);
  await backend("pushMerkleRoot.js");
  start("Pinata simulator", path.join(root, "scripts/localPinataMock.js"));
  start("Backend", path.join(root, "backEnd/server.js"), [], path.join(root, "backEnd"));
  start("Frontend", path.join(root, "frontEnd/node_modules/vite/bin/vite.js"), ["--host", "localhost", "--port", "5173", "--strictPort"], path.join(root, "frontEnd"));
  for (const instance of [1, 2]) start(`Oracle ${instance}`, path.join(root, "oracle/index.js"), [], path.join(root, "oracle"), { PORT: String(5100 + instance), ORACLE_INSTANCE_ID: String(instance), ORACLE_REGISTRY_SNAPSHOT: instance === 1 ? "primary" : "oracle2", ORACLE_START_BLOCK: String(deployment.deploymentBlock) });
  await waitFor(async () => (await (await fetch("http://localhost:5000/health/ready")).json()).status === "ready", "Backend");
  await waitFor(async () => (await fetch("http://localhost:5173")).ok, "Frontend");
  for (const instance of [1, 2]) await waitFor(async () => (await fetch(`http://localhost:${5100 + instance}/health/ready`)).ok, `Oracle ${instance}`);
  const specs = process.argv.slice(2);
  await run("Browser regression", path.join(root, "node_modules/@playwright/test/cli.js"), ["test", ...(specs.length ? specs : ["e2e/tests/user-policy-claim.workflow.spec.js", "e2e/tests/bank-eft.workflow.spec.js", "e2e/tests/unfinished-claim-finality.workflow.spec.js", "e2e/tests/hospital-records.maintenance.spec.js", "e2e/tests/unfinished-benefits.workflow.spec.js", "e2e/tests/unfinished-boundaries.spec.js"]), "--workers=1"], root, { E2E_HEADED: "false", PLAYWRIGHT_HTML_OUTPUT_DIR: "playwright-reports/stabilization" });
}
process.once("SIGINT", () => cleanup().then(() => process.exit(130)));
process.once("SIGTERM", () => cleanup().then(() => process.exit(143)));
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(cleanup);
