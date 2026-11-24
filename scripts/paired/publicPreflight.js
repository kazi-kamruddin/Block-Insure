const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("../../backEnd/node_modules/ethers");
const { amount, digest } = require("./manifest");
const { generatedManifest } = require("./generatedInput");
const { captureFork } = require("./fork");
const { campaignSigners } = require("./generatedPublic");
const { providerFor } = require("./runner");

const publicChains = [11155111, 84532];
const endpointDefaults = { 11155111: "https://sepolia.gateway.tenderly.co", 84532: "https://sepolia.base.org" };
const ceil = (value, factor, base = 100n) => (value * factor + base - 1n) / base;
const precision = (_, value) => typeof value === "bigint" ? String(value) : value;

async function chainQuote({ chainId, provider, actors, localRows }) {
  const fork = await captureFork(provider, chainId);
  if (!fork.fork) throw new Error("Preflight requires a verified testnet fork");
  const [gasPrice, priority, raw, ...balances] = await Promise.all([
    provider.send("eth_gasPrice", []), provider.send("eth_maxPriorityFeePerGas", []),
    provider.send("eth_getBlockByNumber", [ethers.toQuantity(fork.block), false]),
    ...Object.values(actors).map((address) => provider.getBalance(address, fork.block)),
  ]);
  if (raw.hash !== fork.blockHash) throw new Error("Preflight block changed while quoting");
  const tip = BigInt(priority);
  const maxFee = 3n * (BigInt(raw.baseFeePerGas) + tip) > 3n * BigInt(gasPrice) ? 3n * (BigInt(raw.baseFeePerGas) + tip) : 3n * BigInt(gasPrice);
  const gasOracle = chainId === 84532 ? new ethers.Contract("0x420000000000000000000000000000000000000F",
    ["function getL1FeeUpperBound(uint256) view returns(uint256)", "function getOperatorFee(uint256) view returns(uint256)"], provider) : null;
  const samples = new Map();
  for (const row of localRows) {
    const key = row.operationId.split("/").at(-1);
    const gas = BigInt(row.gasUsed);
    const length = row.calldataBytes;
    const old = samples.get(key) ?? { gas: 0n, bytes: 0 };
    samples.set(key, { gas: gas > old.gas ? gas : old.gas, bytes: Math.max(length, old.bytes) });
  }
  if (!samples.has("deploy.manager") || !samples.has("reserve.medical") || !samples.has("manual.corrected-publish")) throw new Error("Reviewed local rehearsal sample is incomplete");
  const manager = require("../../contracts/artifacts/contracts/AcceleratedInsuranceManager.sol/AcceleratedInsuranceManager.json");
  const latestManagerGas = await require("../deploymentGas").estimateDeploymentGas({ provider, chainId,
    from: actors.admin, transaction: { data: manager.bytecode } });
  const gasLimits = new Map(), extraFeeLimits = new Map();
  await Promise.all([...samples].map(async ([name, sample]) => {
    const gas = name === "deploy.manager" ? latestManagerGas.gasLimit : ceil(sample.gas, chainId === 11155111 ? 950n : 160n) + 25000n;
    if (gas >= BigInt(fork.blockGasLimit)) throw new Error("Gas bound cannot fit the preflight block at " + name);
    gasLimits.set(name, gas);
    const extra = gasOracle ? 2n * (await gasOracle.getL1FeeUpperBound(sample.bytes + 1024, { blockTag: fork.block }) +
      await gasOracle.getOperatorFee(gas, { blockTag: fork.block })) + 1n : 0n;
    extraFeeLimits.set(name, extra);
  }));
  const transferGas = chainId === 11155111 ? 150000n : 24000n;
  const transferExtra = gasOracle ? 2n * (await gasOracle.getL1FeeUpperBound(512, { blockTag: fork.block }) +
    await gasOracle.getOperatorFee(transferGas, { blockTag: fork.block })) + 1n : 0n;
  return { chainId, fork, gasPrice: BigInt(gasPrice), fees: { maxFeePerGasWei: maxFee, priorityWei: tip },
    balances: Object.fromEntries(Object.keys(actors).map((role, index) => [role, balances[index]])),
    startingAdminNonce: await provider.getTransactionCount(actors.admin, fork.block), gasLimits, extraFeeLimits,
    transferGas, transferExtra, auxiliaryEth: chainId === 84532 ? ethers.parseEther("0.004") : 0n };
}

function candidate({ quote, generated, actors, sourceCommit, registryReferenceTime, hosted }) {
  const operations = generated.operations.filter(({ kind }) => kind === "transaction");
  const expenses = Object.fromEntries(Object.keys(actors).map((role) => [role, 0n]));
  const gasLimits = {}, extraFeeLimits = {};
  for (const step of operations) {
    const template = step.templateId ?? step.id;
    const gas = quote.gasLimits.get(template), extra = quote.extraFeeLimits.get(template);
    if (gas === undefined || extra === undefined) throw new Error("Missing local quote support for " + template);
    gasLimits[step.id] = gas;
    extraFeeLimits[step.id] = extra;
    expenses[step.role] += gas * quote.fees.maxFeePerGasWei + extra + amount(step.valueEth, step.id);
  }
  const funding = Object.fromEntries(Object.entries(expenses).filter(([role]) => role !== "admin").map(([role, cost]) => {
    const target = ceil(cost, 110n);
    const balance = quote.balances[role];
    return [role, { wallet: actors[role], balanceWei: balance, expenseCapWei: cost, targetWei: target,
      topUpWei: target > balance ? target - balance : 0n }];
  }));
  const fundingCost = Object.values(funding).filter((row) => row.topUpWei > 0n).reduce((sum, row) => sum + row.topUpWei +
    quote.fees.maxFeePerGasWei * quote.transferGas + quote.transferExtra, 0n);
  const maxAdminOutflow = expenses.admin + fundingCost + quote.auxiliaryEth;
  const floor = ceil(quote.balances.admin, 10n);
  const ceiling = quote.balances.admin - floor;
  return { schema: "block-insure-paired-public-plan/v1", manifestHash: generated.baseManifestHash, chainId: quote.chainId,
    sourceCommit, actors, hostedOracleWallets: hosted, repetitions: generated.repetitions, registryReferenceTime,
    operationManifestHash: digest(JSON.stringify(generated.operations)), reviewedRoutingHash: generated.reviewedRoutingHash,
    offchainInputSource: generated.offchainInputSource, preflightBlock: quote.fork.block, preflightBlockHash: quote.fork.blockHash,
    startingAdminNonce: quote.startingAdminNonce, startingAdminWei: quote.balances.admin, retainedAdminWei: floor,
    maxAdminOutflowWei: maxAdminOutflow, spendingCeilingWei: ceiling, funding, gasLimits, extraFeeLimits,
    transferGasLimit: quote.transferGas, transferFeeLimit: quote.transferExtra, hostedSmokeAndHandoverWei: quote.auxiliaryEth,
    fees: quote.fees, fork: quote.fork, quotedGasPriceWei: quote.gasPrice, operationCount: operations.length,
    fits: quote.chainId === 84532 ? maxAdminOutflow * 5n <= ceiling * 4n : maxAdminOutflow <= ceiling };
}

async function makePlans({ scenario, routing, sourceCommit, localRows, urls = endpointDefaults }) {
  const { actors, hosted } = campaignSigners();
  const providers = publicChains.map((chainId) => providerFor(urls[chainId], chainId, false));
  try {
    const quotes = await Promise.all(publicChains.map((chainId, index) => chainQuote({ chainId, provider: providers[index], actors, localRows })));
    const registryReferenceTime = Math.min(...quotes.map(({ fork }) => fork.timestamp));
    const alternatives = [5, 4, 3, 2, 1].map((repetitions) => {
      const generated = generatedManifest({ ...scenario, routing, repetitions });
      return quotes.map((quote) => candidate({ quote, generated, actors, hosted, sourceCommit, registryReferenceTime }));
    });
    const plans = alternatives.find((pair) => pair.every(({ fits }) => fits));
    const options = alternatives.map((pair) => ({ repetitions: pair[0].repetitions, chains: pair.map((item) => ({
      chainId: item.chainId, expectedOutflowWei: item.maxAdminOutflowWei, spendingCeilingWei: item.spendingCeilingWei, fits: item.fits })) }));
    return { plans, options };
  } finally {
    providers.forEach((provider) => provider.destroy());
  }
}

if (require.main === module) (async () => {
  const args = require("../operatorArguments").parseOperatorArguments(process.argv.slice(2), {
    values: ["--output", "--manifest", "--rehearsal", "--source"], required: ["--output", "--manifest", "--rehearsal", "--source"],
  });
  if (!/^[0-9a-f]{40}$/.test(args["--source"])) throw new Error("Supply the verified campaign source commit");
  const scenario = require("./manifest").readManifest(args["--manifest"]);
  const rehearsal = JSON.parse(fs.readFileSync(args["--rehearsal"], "utf8"));
  if (rehearsal.local !== true || rehearsal.manifestHash !== scenario.manifestHash || !rehearsal.complete || !rehearsal.oracleHandoff?.readiness?.ready) {
    throw new Error("A completed generated-input rehearsal is required");
  }
  const results = await makePlans({ scenario, routing: require("../../deploy/paired-v6-live-routing.json"),
    sourceCommit: args["--source"], localRows: rehearsal.rows });
  fs.mkdirSync(args["--output"], { recursive: false });
  fs.writeFileSync(path.join(args["--output"], "candidate-budgets.json"), JSON.stringify(results.options, precision, 2) + "\n", { flag: "wx" });
  if (!results.plans) throw new Error("No repetition count meets both reviewed budgets");
  const planHashes = results.plans.map((plan) => {
    const text = JSON.stringify(plan, precision, 2) + "\n";
    fs.writeFileSync(path.join(args["--output"], `plan-${plan.chainId}.json`), text, { flag: "wx" });
    return { chainId: plan.chainId, hash: digest(text) };
  });
  const review = { repetitions: results.plans[0].repetitions, pairedPlanSha256: digest(planHashes.map(({ hash }) => hash).join("\n")), planHashes };
  fs.writeFileSync(path.join(args["--output"], "plan-identities.json"), JSON.stringify(review, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ ...review, options: results.options }, precision));
})().catch((error) => {
  console.error("Read-only preflight failed: " + (error.code ?? error.message).replace(/https?:\/\/\S+|0x[a-f0-9]{64,}/gi, "[private]"));
  process.exitCode = 1;
});

module.exports = { candidate, makePlans };
