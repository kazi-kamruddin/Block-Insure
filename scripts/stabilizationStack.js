// Isolated regression stack: no saved .env files or normal deployment manifests
// are rewritten. Invoke through runIsolatedE2E.js to supply development actors.
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const children = [];
let stopping = false;
const dailyLauncher = process.argv.includes("--daily-launcher");
const shadowRestart = process.argv.includes("--shadow-restart");
const brevoStub = process.argv.includes("--brevo-stub");
fs.mkdirSync(path.join(root, "tmp"), { recursive: true });
const output = fs.mkdtempSync(path.join(process.env.STABILIZATION_CAMPAIGN_DIR || path.join(root, "tmp"), "stabilization-"));
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
  CLAIM_SUBMISSION_RATE_LIMIT: "100",
  OTP_DELIVERY_MODE: "simulation",
  E2E_CAPTURE_SCREENSHOTS: "true",
  ...(brevoStub ? { OTP_DELIVERY_MODE: "brevo", E2E_BREVO_STUB: "true", E2E_MAILBOX_TOKEN: crypto.randomBytes(32).toString("hex"),
    BREVO_API_KEY: "block-insure-synthetic-only", BREVO_SENDER_EMAIL: "sender@example.test" } : {}),
  APPDATA: path.join(root, ".hardhat-appdata"), LOCALAPPDATA: path.join(root, ".hardhat-localappdata"),
};
const database = new URL(environment.MONGODB_URI);
if (!["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) || !/^\/block_insure_[a-z0-9_]*e2e$/.test(database.pathname)) {
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
    if (label === "Browser regression" || label === "Phase one settlement recovery" || label === "Evidence lifecycle recovery") process.stdout.write(safe);
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
    if (stopping) throw new Error(`${label} cancelled during cleanup`);
    try { if (await check()) return; } catch { /* wait for local service */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not become ready`);
}
async function cleanup() {
  stopping = true;
  for (const child of [...children].reverse()) {
    if (child.exitCode !== null) continue;
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    else child.kill("SIGTERM");
  }
}
async function main() {
  if (process.argv.length === 2) {
    if (!environment.E2E_BACKEND_RPC_URL) throw new Error("The full stabilization campaign requires E2E_RPC_PROXY=true for its RPC recovery stage.");
    // Time-travel scenarios require independent deployments, not merely fresh
    // browser contexts. Never let maturity/expiry poison a later claim fixture.
    const campaign = [
      ["e2e/tests/public-smoke.spec.js", "e2e/tests/authentication-security.spec.js", "e2e/tests/role-workspaces.spec.js", "e2e/tests/route-inventory.spec.js"],
      ["e2e/tests/resilience-security.spec.js"],
      ["e2e/tests/part1-profile.workflow.spec.js"],
      ["e2e/tests/email-delivery.workflow.spec.js", "--brevo-stub"],
      ["e2e/tests/user-policy-claim.workflow.spec.js", "--with-showcase", "--shadow-restart"],
      ["e2e/tests/shadow-concurrency.workflow.spec.js"],
      ["e2e/tests/bank-eft.workflow.spec.js"],
      ["e2e/tests/hospital-records.maintenance.spec.js"],
      ["e2e/tests/cancellation-refund.workflow.spec.js"],
      ["e2e/tests/unfinished-boundaries.spec.js"],
      ...["simultaneous rejection", "expired review", "encrypted corrected appeal"].map((grep) => ["e2e/tests/unfinished-claim-finality.workflow.spec.js", "--grep", grep]),
      ["e2e/tests/rpc-readiness.resilience.spec.js"],
    ];
    const results = [];
    const report = path.join(output, "campaign.json");
    console.log(`[Stabilization] Campaign evidence: ${path.relative(root, output)}`);
    for (const selection of campaign) {
      const startedAt = new Date().toISOString();
      try {
        await run("Browser regression", __filename, selection, root, { STABILIZATION_CAMPAIGN_DIR: output });
        results.push({ selection, startedAt, completedAt: new Date().toISOString(), passed: true });
      } catch (error) {
        results.push({ selection, startedAt, completedAt: new Date().toISOString(), passed: false });
        throw error;
      } finally {
        fs.writeFileSync(report, JSON.stringify({ plannedStages: campaign.length, results }, null, 2));
      }
      console.log(`\n[Stabilization] Passed: ${selection.join(" ")}`);
    }
    return;
  }
  // Refuse to attach to someone else's blockchain.
  try { const response = await fetch(environment.RPC_URL, { signal: AbortSignal.timeout(1000) }); if (response) throw new Error("RPC port is occupied"); } catch (error) { if (error.message === "RPC port is occupied") throw error; }
  const chainChild = dailyLauncher
    ? start("Hardhat daily chain", process.env.npm_execpath, ["run", "dev:chain"])
    : start("Hardhat", path.join(root, "contracts/node_modules/hardhat/internal/cli/cli.js"), ["node", "--hostname", "127.0.0.1"], path.join(root, "contracts"));
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
  if (process.env.E2E_UNFUNDED_RESERVE !== "true") await backend("fundContractLocal.js", ["5"]);
  await backend("pushMerkleRoot.js");
  start("Pinata simulator", path.join(root, "scripts/localPinataMock.js"));
  if (dailyLauncher) {
    environment.LOCAL_DEPLOYMENT_MANIFEST = path.join(output, "localhost-31337.json");
    environment.DAILY_REPORT_DIR = output;
    await run("Daily resume", path.join(root, "scripts/verifyDailyLifecycle.js"), ["resume"]);
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(chainChild.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else chainChild.kill("SIGTERM");
    await run("Daily missing chain", path.join(root, "scripts/verifyDailyLifecycle.js"), ["missing-chain"]);
    console.log(`[Stabilization] Daily lifecycle evidence: ${path.relative(root, output)}`);
    return;
  }
  if (environment.E2E_BACKEND_RPC_URL) {
    start("RPC recovery proxy", path.join(root, "scripts/localRpcProxy.js"));
    await waitFor(async () => (await fetch(`${environment.E2E_BACKEND_RPC_URL}/__control/status`)).ok, "RPC proxy");
  }
  if (process.env.PHASE_ONE_SETTLEMENT_ONLY === "true") {
    await run("Phase one settlement recovery", path.join(root, "backEnd/test/phaseOneSettlement.integration.js"), [], root, { NODE_ENV: "test" });
    return;
  }
  if (process.env.RELEASE_READBACK_ONLY === "true") {
    await run("Deployment readback", path.join(root, "scripts/deploymentReadback.js"), ["--manifest", path.join(output, "localhost-31337.json"), "--local", "--output", path.join(process.env.RELEASE_MEASUREMENTS_DIR, "deployment-readback.json")]);
    return;
  }
  if (process.env.PHASE_TWO_RECOVERY_ONLY === "true") {
    await run("Evidence lifecycle recovery", path.join(root, "backEnd/test/phaseTwoRecovery.integration.js"), [], root, { NODE_ENV: "test" });
    return;
  }
  start("Backend", path.join(root, brevoStub ? "e2e/support/localBrevoBackend.js" : "backEnd/server.js"), [], path.join(root, "backEnd"), environment.E2E_BACKEND_RPC_URL ? { RPC_URL: environment.E2E_BACKEND_RPC_URL } : {});
  start("Frontend", path.join(root, "frontEnd/node_modules/vite/bin/vite.js"), ["--host", "localhost", "--port", "5173", "--strictPort"], path.join(root, "frontEnd"));
  const oracleChildren = [];
  const workerOptions = (instance) => ({ PORT: String(5100 + instance), ORACLE_INSTANCE_ID: String(instance),
    ORACLE_REGISTRY_SNAPSHOT: instance === 1 ? "primary" : "oracle2", ORACLE_START_BLOCK: String(deployment.deploymentBlock),
    ...(shadowRestart && instance === 2 ? { ORACLE2_SIMULATED_NETWORK_DELAY_MS: "10000" } : {}) });
  for (const instance of [1, 2]) oracleChildren.push(start(`Oracle ${instance}`, path.join(root, "oracle/index.js"), [], path.join(root, "oracle"), workerOptions(instance)));
  await waitFor(async () => (await (await fetch("http://localhost:5000/health/ready")).json()).status === "ready", "Backend");
  await waitFor(async () => (await fetch("http://localhost:5173")).ok, "Frontend");
  for (const instance of [1, 2]) await waitFor(async () => (await fetch(`http://localhost:${5100 + instance}/health/ready`)).ok, `Oracle ${instance}`);
  if (process.env.RELEASE_MEASUREMENTS_DIR) {
    const { ethers } = require("../backEnd/node_modules/ethers");
    const rpc = new ethers.JsonRpcProvider(environment.RPC_URL);
    try {
      const checked = await require("./deploymentReadback").verifyDeployment({ manifest: deployment, provider: rpc, local: true });
      const [frontend, backend, oracleOne, oracleTwo, frontendConfiguration] = await Promise.all([
        fetch("http://localhost:5173").then(async (r) => ({ body: await r.text() })),
        ...["http://localhost:5000/health/ready", "http://localhost:5101/health/ready", "http://localhost:5102/health/ready", "http://localhost:5173/release-config.json"].map((url) => fetch(url).then(async (r) => ({ body: await r.json() }))),
      ]);
      require("./hostedPreflight").validateResponses({ frontend, backend, oracleOne, oracleTwo, frontendConfiguration }, { full: true,
        chainId: checked.chainId, modelIdentity: checked.modelIdentityHash, oracleWallets: checked.oracleWallets, components: checked.components,
        frontendOrigin: "http://localhost:5173", backendOrigin: "http://localhost:5000" });
      fs.writeFileSync(path.join(process.env.RELEASE_MEASUREMENTS_DIR, "runtime-readiness.json"), JSON.stringify({ passed: true, scope: "Local actual service/build identity readback; not public hosted acceptance", deployment: checked }, null, 2) + "\n", { flag: "wx" });
    } finally { rpc.destroy(); }
  }
  // Exercise the durability boundary that a post-finality restart cannot test:
  // terminate worker 1 after its mined commitment, before either reveal.
  const protocolRestart = shadowRestart ? (async () => {
    const { ethers } = require("../backEnd/node_modules/ethers"), rpc = new ethers.JsonRpcProvider(environment.RPC_URL);
    try {
      const coordinator = new ethers.Contract(deployment.components.OracleCoordinator, require("../backEnd/abi/OracleCoordinator.json").abi, rpc);
      const wallet = new ethers.Wallet(environment.ORACLE_PRIVATE_KEY).address;
      let requestId, committed;
      await waitFor(async () => {
        requestId = (await coordinator.requestCounter()) - 1n;
        if (requestId < 1n) return false;
        committed = await coordinator.commitments(requestId, wallet);
        return committed !== ethers.ZeroHash && Number(await coordinator.revealCount(requestId)) === 0 && !await coordinator.hasRevealed(requestId, wallet);
      }, "Oracle commitment restart boundary");
      if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(oracleChildren[0].pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      else oracleChildren[0].kill("SIGTERM");
      await waitFor(async () => { try { await fetch("http://127.0.0.1:5101/health/live", { signal: AbortSignal.timeout(500) }); return false; } catch { return true; } }, "Stopped Oracle health port");
      oracleChildren[0] = start("Oracle 1 committed-request recovery", path.join(root, "oracle/index.js"), [], path.join(root, "oracle"), workerOptions(1));
      await waitFor(() => coordinator.hasRevealed(requestId, wallet), "Restarted Oracle reveal");
      if ((await coordinator.commitments(requestId, wallet)) !== committed) throw new Error("Restart changed the mined commitment");
      fs.writeFileSync(path.join(output, "protocol-restart.json"), JSON.stringify({ passed: true, requestId: String(requestId),
        restartedAfterCommitBeforeReveal: true, sameMinedCommitment: true, restartedWorkerRevealed: true,
        boundary: "Existing local disposable deployment only; no Docker/system restart" }, null, 2));
    } finally { rpc.destroy(); }
  })() : null;
  protocolRestart?.catch(() => {});
  const showcase = process.argv.includes("--with-showcase");
  const specs = process.argv.slice(2).filter((arg) => !["--with-showcase", "--shadow-restart", "--brevo-stub"].includes(arg));
  console.log(`[Stabilization] Stage evidence: ${path.relative(root, output)}`);
  const browserReports = (name) => ({ E2E_HEADED: "false", PLAYWRIGHT_HTML_OUTPUT_DIR: path.join(output, name, "report"),
    PLAYWRIGHT_OUTPUT_DIR: path.join(output, name, "artifacts"), PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(output, name, "results.json") });
  let browserFailure;
  try {
    await run("Browser regression", path.join(root, "node_modules/@playwright/test/cli.js"), ["test", ...(specs.length ? specs : ["e2e/tests/user-policy-claim.workflow.spec.js", "e2e/tests/bank-eft.workflow.spec.js", "e2e/tests/unfinished-claim-finality.workflow.spec.js", "e2e/tests/hospital-records.maintenance.spec.js", "e2e/tests/cancellation-refund.workflow.spec.js", "e2e/tests/unfinished-boundaries.spec.js"]), "--workers=1"], root, browserReports("browser"));
  } catch (error) { browserFailure = error; }
  if (process.env.RELEASE_MEASUREMENTS_DIR) await run("Receipt capture", path.join(root, "scripts/captureReleaseChain.js"), [path.join(output, "localhost-31337.json"), process.env.RELEASE_MEASUREMENTS_DIR]);
  if (browserFailure) throw browserFailure;
  if (process.env.PHASE_ONE_SETTLEMENT_TESTS === "true") await run("Phase one settlement recovery", path.join(root, "backEnd/test/phaseOneSettlement.integration.js"), [], root, { NODE_ENV: "test" });
  if (protocolRestart) await protocolRestart;
  if (showcase) await run("Browser regression", path.join(root, "node_modules/@playwright/test/cli.js"), ["test", "e2e/tests/showcase-coverage.spec.js", "--workers=1"], root, browserReports("showcase"));
  if (shadowRestart) {
    const mongoose = require("../backEnd/node_modules/mongoose");
    await mongoose.connect(environment.MONGODB_URI);
    try {
      const Model = require("../backEnd/models/OracleShadowAssessment");
      const before = await Model.countDocuments();
      if (before < 2) throw new Error("No completed dual-worker shadow reports before restart");
      if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(oracleChildren[0].pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      else oracleChildren[0].kill("SIGTERM");
      start("Oracle 1 restart recovery", path.join(root, "oracle/index.js"), [], path.join(root, "oracle"), { PORT: "5101", ORACLE_INSTANCE_ID: "1", ORACLE_REGISTRY_SNAPSHOT: "primary", ORACLE_START_BLOCK: String(deployment.deploymentBlock) });
      await waitFor(async () => {
        const health = await (await fetch("http://127.0.0.1:5101/health/ready")).json();
        return health.status === "ready" && health.shadow.successfulReports >= 1;
      }, "Oracle shadow restart/backfill");
      const after = await Model.countDocuments();
      if (after !== before) throw new Error("Restart created duplicate shadow assessment records");
      const rows = await Model.find().select("metrics").lean();
      fs.writeFileSync(path.join(output, "shadow-restart.json"), JSON.stringify({ passed: true, before, after,
        independentOracleProcessRestarted: true, idempotentBackfill: true, metricScope: "Process memory; context HTTP plus local verification/scoring, excluding report HTTP",
        metrics: rows.map((r) => r.metrics) }, null, 2));
      console.log(`[Stabilization] Shadow restart and operational evidence: ${path.relative(root, output)}`);
    } finally { await mongoose.disconnect(); }
  }
}
process.once("SIGINT", () => cleanup().then(() => process.exit(130)));
process.once("SIGTERM", () => cleanup().then(() => process.exit(143)));
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(cleanup);
