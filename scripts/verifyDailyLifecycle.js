// Runs the actual non-resetting daily launcher on an explicitly prepared local
// test deployment. Does not bootstrap, provision MongoDB or rewrite saved envs.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");
const mongoose = require("../backEnd/node_modules/mongoose");
const { ethers } = require("../backEnd/node_modules/ethers");
const root = path.resolve(__dirname, "..");
const mode = process.argv[2];
const uri = new URL(process.env.MONGODB_URI);
if (!["127.0.0.1", "localhost"].includes(uri.hostname) || uri.pathname !== "/block_insure_e2e" || !process.env.DAILY_REPORT_DIR || !process.env.LOCAL_DEPLOYMENT_MANIFEST) throw new Error("Use the prepared isolated daily-lifecycle harness");
const npm = process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
let child, diagnostics = "";
const files = ["backEnd/.env", "frontEnd/.env", "contracts/.env", "oracle/.env", "oracle/.env.oracle2", "contracts/deployments/localhost-31337.json"];
const hashes = () => Object.fromEntries(files.filter((f) => fs.existsSync(path.join(root, f))).map((f) => [f, crypto.createHash("sha256").update(fs.readFileSync(path.join(root, f))).digest("hex")]));
function launch() {
  diagnostics = "";
  child = spawn(process.execPath, [npm, "run", "dev"], { cwd: root, env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => {
    // Retain only launcher lifecycle messages, never arbitrary application logs.
    diagnostics = (diagnostics + data.toString().split(/\r?\n/).filter((line) => line.includes("[Launcher]")).join("\n")).slice(-8000);
  });
  return child;
}
function stop() {
  if (child?.exitCode === null) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else child.kill("SIGTERM");
  }
}
async function waitFor(check, label, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await check()) return; } catch { /* bounded readiness retry */ }
    if (child?.exitCode !== null) throw new Error(`Daily launcher exited before ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Daily launcher did not reach ${label}`);
}
const json = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
  if (!response.ok) return null;
  return response.json();
};
async function main() {
  const beforeFiles = hashes();
  await mongoose.connect(uri.toString());
  const User = require("../backEnd/models/User");
  const user = new ethers.Wallet(process.env.E2E_USER_PRIVATE_KEY).address.toLowerCase();
  if (mode === "resume") {
    await User.updateOne({ walletAddress: user }, { $set: { name: "Daily lifecycle sentinel", role: "USER" } }, { upsert: true });
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const manager = new ethers.Contract(process.env.CONTRACT_ADDRESS, require("../backEnd/abi/InsuranceManager.json").abi, provider);
    const counters = async () => (await Promise.all([manager.packageCounter(), manager.policyCounter(), manager.claimCounter()])).map(String);
    const original = await counters();
    for (let run = 0; run < 2; run++) {
      launch();
      await waitFor(async () => (await json("http://127.0.0.1:5000/health/ready"))?.status === "ready", "backend readiness");
      await waitFor(async () => (await fetch("http://localhost:5173", { signal: AbortSignal.timeout(2000) })).ok, "frontend readiness");
      for (const port of [5101, 5102]) await waitFor(async () => (await json(`http://127.0.0.1:${port}/health/ready`))?.status === "ready", `Oracle ${port} readiness`);
      assert.equal((await User.findOne({ walletAddress: user }).lean()).name, "Daily lifecycle sentinel");
      assert.deepEqual(await counters(), original);
      assert.match(diagnostics, /Reusing the verified local deployment/);
      stop();
      await new Promise((resolve) => child.exitCode !== null ? resolve() : child.once("exit", resolve));
      assert.equal(await provider.getNetwork().then((n) => n.chainId), 31337n);
      assert.ok(await provider.getBlockNumber() > 0);
    }
    provider.destroy();
    assert.deepEqual(hashes(), beforeFiles);
    fs.writeFileSync(path.join(process.env.DAILY_REPORT_DIR, "daily-resume.json"), JSON.stringify({ mode, passed: true, actualCommand: "npm run dev (twice)", chainCommand: "npm run dev:chain",
      sentinelPreserved: true, countersPreserved: true, externalChainPreserved: true, allFourServiceReadinessChecked: true, savedFilesUnchanged: true }, null, 2));
  } else if (mode === "missing-chain") {
    launch();
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((_, reject) => setTimeout(() => reject(new Error("Missing-chain launcher failed to exit")), 15000))]);
    assert.notEqual(child.exitCode, 0);
    assert.match(diagnostics, /Hardhat state is in-memory/);
    assert.match(diagnostics, /explicit destructive reset/);
    assert.equal((await User.findOne({ walletAddress: user }).lean()).name, "Daily lifecycle sentinel");
    for (const port of [5000, 5101, 5102, 5173]) {
      let listening = false;
      try { await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(700) }); listening = true; } catch { /* expected closed */ }
      assert.equal(listening, false, `Unexpected daily service on ${port}`);
    }
    assert.deepEqual(hashes(), beforeFiles);
    fs.writeFileSync(path.join(process.env.DAILY_REPORT_DIR, "daily-missing-chain.json"), JSON.stringify({ mode, passed: true, exitCode: child.exitCode,
      recoveryInstructions: true, sentinelPreserved: true, noApplicationServicesStarted: true, savedFilesUnchanged: true }, null, 2));
  } else throw new Error("Select resume or missing-chain");
  assert.deepEqual(hashes(), beforeFiles);
  console.log(`Daily ${mode}: PASS`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => { stop(); await mongoose.disconnect(); });
