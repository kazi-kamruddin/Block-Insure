const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("../../backEnd/node_modules/ethers");
const { digest, readManifest } = require("./manifest");
const { campaignSigners } = require("./generatedPublic");
const { guardedDeployer } = require("./publicBootstrap");
const { providerFor } = require("./runner");

async function handover({ directory, deployment, campaign, comparison, reconciliation, plan, provider, signers, hosted }) {
  if (campaign.chainId !== 84532 || campaign.local || !campaign.complete || !comparison.complete || comparison.excluded.length ||
      !comparison.paired.every((row) => row.offchainInputSource === campaign.offchainInputSource) ||
      campaign.sourceCommit !== comparison.sourceCommit || campaign.rows.length !== comparison.paired.length ||
      !reconciliation.reconciled || !reconciliation.floorVerified || reconciliation.campaignPlanHash !== campaign.planHash ||
      campaign.componentAddresses.InsuranceManager !== deployment.components.InsuranceManager ||
      deployment.components.InsuranceManager.toLowerCase() === "0xbec2a1b6215012cc7e59b0495f0d84c512003f96") {
    throw new Error("Handover requires a complete comparison and the fresh measured Base deployment");
  }
  const coordinator = new ethers.Contract(deployment.components.OracleCoordinator,
    require("../../oracle/abi/OracleCoordinator.json").abi, provider);
  const role = ethers.id("ORACLE_ROLE");
  const manager = deployment.components.InsuranceManager;
  const abi = new ethers.Interface(require("../../backEnd/abi/InsuranceManager.json").abi);
  const campaignWallets = [signers.oracle1.address, signers.oracle2.address];
  const active = await coordinator.getActiveOracles();
  if (active.some((address) => ![...campaignWallets, ...hosted].includes(address)) || await coordinator.quorumThreshold() !== 2n) {
    throw new Error("Base Oracle roster differs from the authorized handover");
  }
  const next = await coordinator.requestCounter();
  for (let id = 1n; id < next; id += 1n) {
    if (!(await coordinator.getRequest(id)).isFulfilled) throw new Error("Complete every measured Oracle request before changing roles");
  }
  const wallet = new ethers.Wallet(signers.admin.privateKey, provider);
  // The registry removes by swapping in its last element. Grant in reverse order
  // so the post-handover roster still agrees with Worker 1 and Worker 2.
  const steps = [...hosted.map((address, index) => ({ method: "grantRole", address, id: `handover.hosted-${index + 1}` })).reverse(),
    ...campaignWallets.map((address, index) => ({ method: "revokeRole", address, id: `handover.measured-${index + 1}` }))]
    .map((step) => ({ ...step, recipient: manager, valueEth: "0" }));
  const anchor = path.join(directory, "handover-anchor.json");
  const context = { sourceCommit: campaign.sourceCommit, campaignPlanHash: campaign.planHash, measured: campaignWallets, hosted };
  const oracle = new ethers.Contract("0x420000000000000000000000000000000000000F",
    ["function getL1FeeUpperBound(uint256) view returns(uint256)", "function getOperatorFee(uint256) view returns(uint256)"], provider);
  const gasLimit = "350000";
  const quoteExtra = async () => await oracle.getL1FeeUpperBound(1024) + await oracle.getOperatorFee(gasLimit);
  if (!fs.existsSync(anchor)) {
    if (active.length !== 2 || campaignWallets.some((address) => !active.includes(address))) throw new Error("The measured roster must be active at the start of handover");
    const nonce = await provider.getTransactionCount(wallet.address, "latest");
    if (nonce !== await provider.getTransactionCount(wallet.address, "pending")) throw new Error("Unexpected admin transaction pending before handover");
    fs.writeFileSync(anchor, JSON.stringify({ ...context, nonce, extraCapWei: String((await quoteExtra()) * 4n + 1024n) }) + "\n", { flag: "wx" });
  }
  const intent = JSON.parse(fs.readFileSync(anchor));
  if (!Number.isSafeInteger(intent.nonce) || Object.entries(context).some(([key, value]) => JSON.stringify(intent[key]) !== JSON.stringify(value))) {
    throw new Error("Handover anchor changed");
  }
  const extraCap = BigInt(intent.extraCapWei);
  if ((BigInt(gasLimit) * BigInt(plan.fees.maxFeePerGasWei) + extraCap) * BigInt(steps.length) > BigInt(plan.hostedSmokeAndHandoverWei)) {
    throw new Error("Oracle handover exceeds the remaining hosted budget reservation");
  }
  const gasLimits = Object.fromEntries(steps.map(({ id }) => [id, gasLimit]));
  const extraFeeLimits = Object.fromEntries(steps.map(({ id }) => [id, String(extraCap)]));
  const control = { ...plan, gasLimits, extraFeeLimits, startingAdminNonce: intent.nonce };
  const guard = guardedDeployer({ wallet, provider, output: directory, fundingSteps: steps, plan: control, target: "handover-journal",
    planHash: digest(JSON.stringify({ context, nonce: intent.nonce, gasLimits, extraFeeLimits })), chainId: 84532,
    extraFee: quoteExtra });
  try {
    for (const step of steps) await wallet.sendTransaction({ to: manager, data: abi.encodeFunctionData(step.method, [role, step.address]) });
    guard.assertComplete();
    const result = await coordinator.getActiveOracles();
    if (result.length !== 2 || hosted.some((address, index) => result[index] !== address)) throw new Error("Final hosted Oracle roster did not verify");
    return guard.entries.filter(({ type }) => type === "receipt");
  } finally { guard.close(); }
}

if (require.main === module) (async () => {
  const opts = require("../operatorArguments").parseOperatorArguments(process.argv.slice(2), {
    values: ["--manifest", "--result", "--comparison"], switches: ["--confirm-public"], required: ["--manifest", "--result", "--comparison"],
  });
  if (!opts["--confirm-public"] || process.env.PAIRED_ALLOW_PUBLIC_SENDS !== "true") throw new Error("Explicit Base handover authorization is required");
  const directory = path.resolve(opts["--result"]);
  const read = (file) => JSON.parse(fs.readFileSync(file));
  const [campaign, deployment, plan, reconciliation] = ["campaign.json", "baseSepolia-84532.json", "run-plan.json", "reconciliation.json"]
    .map((name) => read(path.join(directory, name)));
  const comparison = read(opts["--comparison"]);
  if (readManifest(opts["--manifest"]).manifestHash !== campaign.manifestHash || digest(fs.readFileSync(path.join(directory, "run-plan.json"))) !== campaign.planHash) {
    throw new Error("Base handover plan differs from measured campaign");
  }
  const { signers, hosted } = campaignSigners();
  const provider = providerFor("https://sepolia.base.org", 84532, false);
  try { console.log(JSON.stringify(await handover({ directory, deployment, campaign, comparison, reconciliation, plan, provider, signers, hosted }))); }
  finally { provider.destroy(); }
})().catch((error) => {
  console.error("Base handover stopped: " + String(error.code ?? error.message).replace(/https?:\/\/\S+|0x[a-f0-9]{64,}/gi, "[private]"));
  process.exitCode = 1;
});

module.exports = { handover };
