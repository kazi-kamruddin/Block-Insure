// Locally runs only uniquely named, labelled synthetic installation resources.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
async function main() {
  const stamp = `${Date.now()}-${process.pid}`, prefix = `block-insure-release-${stamp}`;
  const output = path.join(root, "tmp", prefix); fs.mkdirSync(output, { recursive: true });
  const docker = (args) => execFileSync("docker", args, { cwd: root, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const containers = [], created = []; let receipt;
  const run = (label, args) => { const name = `${prefix}-${label}`; containers.push(name); docker(["run", "-d", "--name", name, "--label", "com.blockinsure.release-probe=true", "--network", prefix, ...args]); return name; };
  const waitFor = async (check) => { for (let n = 0; n < 60; n++) { try { if (await check()) return; } catch {} await new Promise((r) => setTimeout(r, 1000)); } throw new Error("Installation readiness timed out"); };
  try {
    docker(["network", "create", "--internal", prefix]); created.push(prefix);
    const mongoImage = docker(["inspect", "block-insure-part1-mongo", "--format", "{{.Config.Image}}"]);
    run("mongo", ["--network-alias", "mongo", "--memory", "512m", "--tmpfs", "/data/db", mongoImage, "--bind_ip_all", "--quiet"]);
    const Recrypt = require("../backEnd/node_modules/@ironcorelabs/recrypt-node-binding");
    const { serializeCryptoObject } = require("../backEnd/services/preTransformService");
    const environment = { NODE_ENV: "production", BLOCKCHAIN_RUNTIME_ENABLED: "false", INDEXER_ENABLED: "false", FORCE_PUBLIC_DNS: "false", TRUST_PROXY: "1", PORT: "5000",
      MONGODB_URI: "mongodb://mongo:27017/block_insure_phase3_install_test", JWT_SECRET: crypto.randomBytes(32).toString("hex"), BANK_OTP_SECRET: crypto.randomBytes(32).toString("hex"),
      ORACLE_API_KEY: crypto.randomBytes(32).toString("hex"), PRE_PROXY_SIGNING_KEYS_JSON: serializeCryptoObject(new Recrypt.Api256().generateEd25519KeyPair()),
      ALLOWED_ORIGINS: "https://release.example.test", SIWE_URI: "https://release.example.test", SIWE_DOMAIN: "release.example.test", PINATA_JWT: "synthetic-installation-only", OTP_DELIVERY_MODE: "disabled" };
    const envPath = path.join(output, "installation.env");
    fs.writeFileSync(envPath, Object.entries(environment).map(([key, value]) => `${key}=${value}`).join("\n"), { mode: 0o600, flag: "wx" });
    const backend = run("api", ["--network-alias", "backend", "--memory", "512m", "--env-file", envPath, "block-insure-phase3-api:local"]);
    const healthProgram = "fetch('http://127.0.0.1:5000/health/ready').then(async r=>{let b=await r.json();if(!r.ok||b.status!=='limited'||b.services.database!=='connected')process.exit(1);console.log('limited-preview-ready')}).catch(()=>process.exit(1))";
    await waitFor(() => docker(["exec", backend, "node", "-e", healthProgram]) === "limited-preview-ready");
    const web = run("web", ["--memory", "96m", "block-insure-phase3-web:local"]);
    await waitFor(() => /Block-Insure/.test(docker(["exec", web, "wget", "-qO-", "http://127.0.0.1:8080/user/claims/new"])));
    const routed = docker(["exec", backend, "node", "-e", `fetch('http://${web}:8080/api/users/me').then(async r=>{if(r.status!==401||!(await r.json()).message)process.exit(1);console.log('authorized-route-denied')}).catch(()=>process.exit(1))`]);
    assert.equal(routed, "authorized-route-denied");
    const imageIds = {};
    for (const role of ["api", "oracle", "web"]) imageIds[role] = docker(["image", "inspect", `block-insure-phase3-${role}:local`, "--format", "{{.Id}}"]);
    receipt = { passed: true, checkedAt: new Date().toISOString(), imageIds,
      scope: "Production-mode off-chain API startup, isolated MongoDB, Nginx SPA/API routing. No public chain, real email or hosted acceptance.",
      syntheticConfiguration: true };
  } finally {
    const remaining = [];
    for (const name of containers.reverse()) {
      try { docker(["rm", "-f", name]); } catch { /* verify absence below */ }
      if (docker(["ps", "-aq", "--filter", `name=^/${name}$`])) remaining.push(name);
    }
    for (const name of created) { try { docker(["network", "rm", name]); } catch { remaining.push(name); } }
    if (remaining.length) throw new Error("Probe cleanup could not be verified");
  }
  if (receipt) {
    fs.writeFileSync(path.join(output, "installation.json"), JSON.stringify({ ...receipt, resourcesRemovedOnExit: true }, null, 2) + "\n");
    console.log(`Installation probe passed: ${path.relative(root, output)}`);
  }
}
main().catch(() => { console.error("Release installation probe failed. Inspect the uniquely labelled local probe resources privately; real configuration was not used."); process.exitCode = 1; });
