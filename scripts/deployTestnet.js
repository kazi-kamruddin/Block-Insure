// Bootstrap a new testnet deployment without requiring addresses that do not exist yet.
// Default is offline validation. --probe reads the network; --apply explicitly sends.
const fs = require("node:fs"), path = require("node:path");
const { spawnSync } = require("node:child_process");
const { ethers } = require("../backEnd/node_modules/ethers");
const { parseEnv } = require("./releaseCheck");
const { assertDeploymentSigner } = require("./deploymentNetworkSafety");
const root = path.resolve(__dirname, "..");
const NETWORKS = { sepolia: { chainId: 11155111, rpcKey: "SEPOLIA_RPC_URL" }, baseSepolia: { chainId: 84532, rpcKey: "BASE_SEPOLIA_RPC_URL" } };
function validateBootstrap(network, environment) {
  const target = NETWORKS[network]; if (!target) throw new Error("Choose sepolia or baseSepolia");
  const rpc = environment[target.rpcKey] || environment.RPC_URL;
  if (!rpc || new URL(rpc).protocol !== "https:") throw new Error("Configure the selected HTTPS RPC privately");
  if (Number(environment.CHAIN_ID) !== target.chainId) throw new Error("Bootstrap chain differs from network");
  const wallet = new ethers.Wallet(environment.ADMIN_PRIVATE_KEY);
  assertDeploymentSigner(target.chainId, wallet.address);
  const calendarProfile = environment.CALENDAR_PROFILE || "QUARTERLY";
  if (!["QUARTERLY", "ACCELERATED_TESTNET"].includes(calendarProfile)) throw new Error("Unknown CALENDAR_PROFILE");
  for (const key of ["INITIAL_POLICY_PREMIUM_ETH", "INITIAL_POLICY_COVERAGE_ETH", "INITIAL_BENEFITS_RESERVE_ETH"]) if (!environment[key] || ethers.parseEther(environment[key]) <= 0n) throw new Error("Specify positive reviewed initial test amounts");
  return { ...target, rpc, signer: wallet.address, calendarProfile };
}
async function main() {
  const args = require("./operatorArguments").parseOperatorArguments(process.argv.slice(2), { values: ["--network", "--env", "--output-dir"], switches: ["--probe", "--apply"], required: ["--network", "--env"] });
  const environment = parseEnv(fs.readFileSync(path.resolve(args["--env"]), "utf8"));
  const target = validateBootstrap(args["--network"], environment);
  const report = { network: args["--network"], chainId: target.chainId, signer: target.signer, calendarProfile: target.calendarProfile, transactionSent: false, configurationValidated: true };
  if (args["--probe"] || args["--apply"]) {
    const request = new ethers.FetchRequest(target.rpc); request.timeout = 10000;
    const provider = new ethers.JsonRpcProvider(request);
    try {
      if ((await provider.getNetwork()).chainId !== BigInt(target.chainId)) throw new Error("RPC chain mismatch");
      report.signerBalanceWei = String(await provider.getBalance(target.signer));
      if (args["--apply"] && report.signerBalanceWei === "0") throw new Error("Fund the dedicated testnet signer before deployment");
      try {
        const name = target.calendarProfile === "ACCELERATED_TESTNET" ? "AcceleratedInsuranceManager" : "InsuranceManager";
        const artifact = JSON.parse(fs.readFileSync(path.join(root, `contracts/artifacts/contracts/${name}.sol/${name}.json`)));
        const quote = await require("./deploymentGas").estimateDeploymentGas({ provider, chainId: target.chainId, transaction: { data: artifact.bytecode }, from: target.signer });
        report.deploymentSimulation = { passed: true, estimatedGas: String(quote.estimatedGas), gasLimit: String(quote.gasLimit), totalBudget: String(quote.totalBudget), accounting: quote.accounting,
          scope: "Manager creation estimate only; excludes later deployment/wiring, reserves and L2 data fees" };
      } catch {
        report.deploymentSimulation = { passed: false, reason: "Check signer funds and an RPC supporting the selected network's current total-gas model/cap" };
        if (args["--apply"]) throw Object.assign(new Error("Public creation simulation must pass before deployment"),
          { operatorHint: "No transaction was sent: fund the selected signer and use an RPC that can estimate the current network's total deployment gas. Sepolia state-heavy creation can exceed a provider's 50M simulation cap." });
      }
    } finally { provider.destroy(); }
  }
  if (args["--apply"]) {
    const directory = path.resolve(args["--output-dir"] || path.join(root, "verification-results", `deployment-${args["--network"]}-${Date.now()}`));
    if (!directory.startsWith(root + path.sep) || fs.existsSync(directory)) throw new Error("Select a new output directory inside the workspace");
    fs.mkdirSync(directory, { recursive: true });
    const execution = spawnSync(process.execPath, [path.join(root, "contracts/node_modules/hardhat/internal/cli/cli.js"), "run", "scripts/deploy.js", "--network", args["--network"]], {
      cwd: path.join(root, "contracts"), windowsHide: true, encoding: "utf8", env: { ...process.env, ...environment,
        [target.rpcKey]: target.rpc, RPC_URL: target.rpc, DEPLOY_WRITE_ENV: "false", DEPLOYMENT_OUTPUT_DIR: directory } });
    const secrets = Object.entries(environment).filter(([key, value]) => value && /KEY|SECRET|TOKEN|JWT|URI|URL/.test(key)).map(([, value]) => value).sort((a, b) => b.length - a.length);
    let diagnostics = String(execution.stdout || "") + String(execution.stderr || "");
    for (const value of secrets) diagnostics = diagnostics.replaceAll(value, "[private configuration]");
    fs.writeFileSync(path.join(directory, "deployment.log"), diagnostics, { flag: "wx" });
    if (execution.status !== 0 || execution.error) throw new Error("Deployment failed; retain any mined receipts and inspect the private deployment log before retrying");
    report.transactionSent = true; report.manifestDirectory = path.relative(root, directory);
  }
  console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) main().catch((error) => { console.error("Testnet bootstrap failed. Check the explicit network/private file, signer, funds and any existing deployment receipts. Saved application configuration was not overwritten."); if (error.operatorHint) console.error(error.operatorHint); process.exitCode = 1; });
module.exports = { validateBootstrap };
