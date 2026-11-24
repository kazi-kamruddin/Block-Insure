const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { ethers } = require("../../backEnd/node_modules/ethers");
const { digest, readManifest } = require("./manifest");
const { generatedManifest, bootstrapRole } = require("./generatedInput");
const { campaignSigners, verifySpendingPlan } = require("./generatedPublic");
const { guardedDeployer } = require("./publicBootstrap");
const { assertParity, verifyPaired } = require("./deployment");
const { bindRoles } = require("./rehearseBootstrap");
const { providerFor, canonicalReceipt } = require("./runner");
const { run } = require("./run");

const root = path.resolve(__dirname, "../..");
const targets = [
  { chainId: 11155111, name: "sepolia", rpc: "https://sepolia.gateway.tenderly.co", env: "SEPOLIA_RPC_URL" },
  { chainId: 84532, name: "baseSepolia", rpc: "https://sepolia.base.org", env: "BASE_SEPOLIA_RPC_URL" },
];
const feeOracleInterface = ["function getL1FeeUpperBound(uint256) view returns(uint256)", "function getOperatorFee(uint256) view returns(uint256)"];
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const persist = (file, value) => {
  const bytes = JSON.stringify(value, (_, item) => typeof item === "bigint" ? String(item) : item, 2) + "\n";
  if (!fs.existsSync(file)) fs.writeFileSync(file, bytes, { flag: "wx" });
  else if (fs.readFileSync(file, "utf8") !== bytes) throw new Error("Campaign evidence scope changed during recovery");
};

async function bootstrap({ operation, scenarioPath, manifest, manifestHash, actors, signers }) {
  const { target, directory, provider, plan, planHash, planFile, budget } = operation;
  const deploymentPath = path.join(directory, `${target.name}-${target.chainId}.json`);
  if (!fs.existsSync(deploymentPath)) {
    await new Promise((resolve, reject) => {
      const env = { ...process.env, [target.env]: target.rpc, RPC_URL: target.rpc, ADMIN_PRIVATE_KEY: signers.admin.privateKey,
        PAIRED_SCENARIO_FILE: scenarioPath, DEPLOY_WRITE_ENV: "false", DEPLOYMENT_OUTPUT_DIR: directory,
        PAIRED_BOOTSTRAP_PLAN_FILE: planFile, PAIRED_REVIEWED_BOOTSTRAP_PLAN: planHash };
      const child = spawn(process.execPath, [path.join(root, "contracts/node_modules/hardhat/internal/cli/cli.js"), "run", "--no-compile",
        "scripts/deploy.js", "--network", target.name], { cwd: path.join(root, "contracts"), env, windowsHide: true, stdio: "ignore" });
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Guarded deployment stopped for ${target.chainId}. Reconcile its operation journal.`)));
    });
  }
  const deployment = read(deploymentPath);
  await verifyPaired({ manifest, manifestHash, deployment, provider, local: false, bootstrap: true, actors });
  await bindRoles({ provider, chainId: target.chainId, directory, deployment, manifest, manifestHash, startTime: plan.registryReferenceTime,
    admin: signers.admin, publicOptions: { actors, planHash, fees: plan.fees, gasLimits: plan.gasLimits, checkBudget: budget.checkBudget } });
  operation.deployment = deployment;
  operation.deploymentPath = deploymentPath;
  operation.readback = await verifyPaired({ manifest, manifestHash, deployment, provider, local: false, actors });
  const readbackPath = path.join(directory, "readback.json");
  if (!fs.existsSync(readbackPath)) persist(readbackPath, operation.readback);
  else if (read(readbackPath).configurationHash !== operation.readback.configurationHash) {
    throw new Error("Deployment readback changed during campaign recovery");
  }
}

async function fund({ operation, manifest, signers }) {
  const { directory, plan, planHash, provider, target, budget } = operation;
  const wallet = new ethers.Wallet(signers.admin.privateKey, provider);
  const steps = Object.entries(plan.funding).filter(([, config]) => BigInt(config.topUpWei) > 0n).map(([role, config]) => ({
    id: "funding." + role, method: "transfer", recipient: config.wallet, valueEth: ethers.formatEther(config.topUpWei),
  }));
  const gasLimits = Object.fromEntries(steps.map(({ id }) => [id, plan.transferGasLimit]));
  const extraFeeLimits = Object.fromEntries(steps.map(({ id }) => [id, plan.transferFeeLimit]));
  const prior = manifest.operations.filter((step) => step.category === "bootstrap" || bootstrapRole.test(step.id)).length;
  const oracle = target.chainId === 84532 ? new ethers.Contract("0x420000000000000000000000000000000000000F", feeOracleInterface, provider) : null;
  const guard = guardedDeployer({ wallet, provider, output: directory, fundingSteps: steps, chainId: target.chainId, planHash,
    plan: { ...plan, startingAdminNonce: plan.startingAdminNonce + prior, gasLimits, extraFeeLimits }, target: "funding-journal",
    extraFee: async (_, gas) => oracle ? await oracle.getL1FeeUpperBound(512) + await oracle.getOperatorFee(gas) : 0n });
  try {
    const known = new Set(guard.entries.filter((entry) => entry.type === "signed").map(({ operationId }) => operationId));
    for (const step of steps) {
      const config = plan.funding[step.id.slice("funding.".length)];
      const balance = await provider.getBalance(config.wallet);
      if (!known.has(step.id) && balance !== BigInt(config.balanceWei)) throw new Error("Funded wallet changed after the reviewed quote");
      await wallet.sendTransaction({ to: step.recipient, value: ethers.parseEther(step.valueEth) });
    }
    guard.assertComplete();
    const receipts = await Promise.all(guard.entries.filter((entry) => entry.type === "receipt").map(async ({ operationId, hash }) => {
      const result = await canonicalReceipt(provider, hash);
      const execution = BigInt(result.receipt.gasUsed) * BigInt(result.receipt.effectiveGasPrice);
      return { operationId, offchainInputSource: plan.offchainInputSource, hash, blockHash: result.block.hash,
        blockNumber: Number(result.block.number), from: result.tx.from, to: result.tx.to, valueWei: String(BigInt(result.tx.value)),
        executionFeeWei: String(execution), l1DataFeeWei: result.receipt.l1Fee == null ? null : String(BigInt(result.receipt.l1Fee)),
        operatorFeeWei: result.receipt.operatorFee == null ? await budget.operatorFee(result) : String(BigInt(result.receipt.operatorFee)) };
    }));
    persist(path.join(directory, "funding-receipts.json"), receipts);
  } finally { guard.close(); }
}

async function main() {
  const opts = require("../operatorArguments").parseOperatorArguments(process.argv.slice(2), {
    values: ["--manifest", "--preflight", "--source", "--reviewed-pair"], switches: ["--confirm-public", "--prepare-only"],
    required: ["--manifest", "--preflight", "--source", "--reviewed-pair"],
  });
  if (!opts["--confirm-public"] || process.env.PAIRED_ALLOW_PUBLIC_SENDS !== "true" || !process.env.PAIRED_CAMPAIGN_MONGO_URL ||
      !/^[0-9a-f]{40}$/.test(opts["--source"])) throw new Error("Explicit public authorization, source and disposable readiness database are required");
  const git = (...args) => execFileSync("git", ["-c", "safe.directory=" + root.replaceAll("\\", "/"), "-C", root, ...args], { windowsHide: true }).toString().trim();
  if (git("rev-parse", "HEAD") !== opts["--source"] || git("status", "--porcelain")) throw new Error("Campaign requires the exact clean reviewed commit");
  const campaignRoot = path.resolve(opts["--preflight"]);
  if (!campaignRoot.startsWith(path.join(root, "verification-results") + path.sep)) throw new Error("Campaign evidence must stay in the local results tree");
  const scenarioPath = path.resolve(opts["--manifest"]);
  const scenario = readManifest(scenarioPath);
  const { actors, hosted, signers } = campaignSigners();
  const routing = require("../../deploy/paired-v6-live-routing.json");
  const operations = targets.map((target) => {
    const planFile = path.join(campaignRoot, `plan-${target.chainId}.json`);
    const bytes = fs.readFileSync(planFile);
    return { target, planFile, plan: JSON.parse(bytes), planHash: digest(bytes), provider: providerFor(target.rpc, target.chainId, false),
      directory: path.join(campaignRoot, target.name) };
  });
  try {
    if (digest(operations.map(({ planHash }) => planHash).join("\n")) !== opts["--reviewed-pair"]) throw new Error("Exact reviewed pair-plan hash is required");
    const { manifestHash } = scenario;
    const repetitions = operations[0].plan.repetitions;
    const manifest = generatedManifest({ ...scenario, routing, repetitions });
    if (operations.some(({ plan, target }) => !plan.fits || plan.repetitions !== repetitions || plan.chainId !== target.chainId ||
      plan.sourceCommit !== opts["--source"] || plan.manifestHash !== manifestHash || plan.offchainInputSource !== manifest.offchainInputSource ||
      plan.operationManifestHash !== digest(JSON.stringify(manifest.operations)) || plan.reviewedRoutingHash !== manifest.reviewedRoutingHash ||
      Object.entries(actors).some(([role, wallet]) => wallet !== plan.actors[role]) || hosted.some((wallet, index) => wallet !== plan.hostedOracleWallets[index]) ||
      plan.registryReferenceTime !== operations[0].plan.registryReferenceTime)) throw new Error("Review the same preflight plan on both chains");
    await Promise.all(operations.map(async (operation) => {
      const { plan, provider, target } = operation;
      operation.budget = await verifySpendingPlan({ manifest, plan, provider, chainId: target.chainId, actors });
      if (!fs.existsSync(operation.directory)) {
        if (await provider.getTransactionCount(actors.admin, "pending") !== plan.startingAdminNonce) throw new Error("Admin nonce changed after preflight");
        fs.mkdirSync(operation.directory);
      }
    }));
    // A failed chain never opens the later funding phase on the other chain.
    for (const operation of operations) await bootstrap({ operation, scenarioPath, manifest, manifestHash, actors, signers });
    assertParity(operations[0].readback, operations[1].readback);
    for (const operation of operations) await fund({ operation, manifest, signers });
    if (opts["--prepare-only"]) return;
    const roles = path.join(campaignRoot, "actors.json");
    persist(roles, actors);
    for (const operation of operations) {
      if (fs.existsSync(path.join(operation.directory, "campaign.json"))) continue;
      const runPlan = path.join(operation.directory, "run-plan.json");
      persist(runPlan, { ...operation.plan, deploymentManifestHash: digest(fs.readFileSync(operation.deploymentPath)) });
      process.env.PAIRED_RPC_URL = operation.target.rpc;
      process.env.BLOCK_INSURE_SOURCE_COMMIT = opts["--source"];
      await run({ "--confirm-public": true, "--generated-offchain-inputs": true, "--network": String(operation.target.chainId),
        "--manifest": scenarioPath, "--roles": roles, "--plan": runPlan, "--deployment": operation.deploymentPath,
        "--output": operation.directory, "--reviewed-plan": digest(fs.readFileSync(runPlan)) });
    }
  } finally { operations.forEach(({ provider }) => provider.destroy()); }
}

if (require.main === module) main().catch((error) => {
  console.error("Paired public campaign stopped: " + String(error.code ?? error.message).replace(/https?:\/\/\S+|0x[a-f0-9]{64,}/gi, "[private]"));
  process.exitCode = 1;
});

module.exports = { bootstrap, fund };
