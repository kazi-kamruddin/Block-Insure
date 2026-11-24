const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { ethers } = require("../../backEnd/node_modules/ethers");
const { readManifest, digest, amount } = require("./manifest");
const { parseOperatorArguments } = require("../operatorArguments");
const { assertDeploymentSigner } = require("../deploymentNetworkSafety");
const { verifyPaired, fundingQuote } = require("./deployment");
const { waitForReadiness } = require("./readiness");
const { captureFork } = require("./fork");
const { isServiceTransaction } = require("./serviceReceipts");
const { configuredRoles, providerFor, materialize, openJournal, executeIntent, rowFor, waitFor } = require("./runner");

function readJson(file) {
  const bytes = fs.readFileSync(file);
  return { data: JSON.parse(bytes), hash: digest(bytes) };
}

function validateObservation({ witness, planDirectory, step, chainId, manifestHash, deploymentManifestHash, local }) {
  if (!witness || typeof witness.file !== "string" || !/^[a-f\d]{64}$/.test(witness.evidenceSha256)) {
    throw new Error("App-stage evidence missing for " + step.id);
  }
  const file = path.resolve(planDirectory, witness.file);
  const relative = path.relative(planDirectory, file);
  if (!relative || relative.startsWith(".." + path.sep) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error("Observation evidence must use the reviewed plan directory");
  }
  const { data, hash } = readJson(file);
  if (hash !== witness.evidenceSha256 || data.schema !== "block-insure-paired-app-observation/v1" ||
      data.operationId !== step.id || data.method !== step.method || data.chainId !== chainId ||
      data.manifestHash !== manifestHash || data.deploymentManifestHash !== deploymentManifestHash ||
      !Number.isFinite(Date.parse(data.observedAt)) || data.status !== "confirmed" || !data.outcome) {
    throw new Error("App-stage proof differs from the reviewed campaign at " + step.id);
  }
  if (!local && data.source !== "isolated live services") {
    throw new Error("Public campaign requires an isolated live-service observation for " + step.id);
  }
  return hash;
}

function publicKeysDisabled() {
  return !process.env.PAIRED_ALLOW_PUBLIC_SENDS || process.env.PAIRED_ALLOW_PUBLIC_SENDS !== "true";
}

async function baseComponentCeiling(oracle, item, gas) {
  if (!oracle) return 0n;
  const [l1, operator] = await Promise.all([
    oracle.getL1FeeUpperBound((item.tx.data.length - 2) / 2 + 512), oracle.getOperatorFee(gas),
  ]);
  return l1 + operator;
}

async function planQuote({ provider, items, plan, local, chainId, manifest }) {
  const price = BigInt(plan.fees.maxFeePerGasWei);
  const tip = BigInt(plan.fees.priorityWei);
  if (price <= 0n || tip < 0n || tip > price) throw new Error("Invalid reviewed fee limits");
  const gasOracle = !local && chainId === 84532 ? new ethers.Contract("0x420000000000000000000000000000000000000F",
    ["function getL1FeeUpperBound(uint256) view returns(uint256)", "function getOperatorFee(uint256) view returns(uint256)"], provider) : null;
  const gasBudget = BigInt((await provider.getBlock("latest")).gasLimit);
  const caps = new Map();
  let fees = 0n;
  const rows = [];
  for (const item of items.values()) {
    const gas = BigInt(item.detail.gasLimit);
    if (gas >= gasBudget) throw new Error("Reviewed gas cap exceeds current block limit");
    const fee = gas * price + await baseComponentCeiling(gasOracle, item, gas);
    caps.set(item.step.id, fee);
    fees += fee;
    rows.push({ operationId: item.step.id, role: item.step.role, from: item.from, recipient: item.target,
      valueWei: item.tx.value, feeCeilingWei: fee, maximumOutflowWei: item.tx.value + fee });
  }
  if (fees > amount(manifest.budget.feeCeilingEth, "fee cap")) throw new Error("Reviewed transactions exceed the campaign fee ceiling");
  const maxOutflowByWallet = Object.fromEntries(configuredRoles.map((role) =>
    [role, rows.filter((row) => row.role === role).reduce((sum, row) => sum + row.maximumOutflowWei, 0n)]));
  const totalOutflowWei = Object.values(maxOutflowByWallet).reduce((sum, outflow) => sum + outflow, 0n);
  if (totalOutflowWei > BigInt(plan.totalOutflowLimitWei)) throw new Error("Campaign exceeds reviewed total outflow");
  for (const [role, value] of Object.entries(maxOutflowByWallet)) {
    if (value > BigInt(plan.walletOutflowLimitsWei[role])) throw new Error("Campaign exceeds reviewed " + role + " outflow");
  }
  return { caps, gasOracle, rows, maxOutflowByWallet, totalOutflowWei };
}

async function pinnedRequest(item, deployment, provider, blockNumber) {
  if (item.detail.requestId == null) return null;
  const abi = require("../../oracle/abi/OracleCoordinator.json").abi;
  const oracle = new ethers.Contract(deployment.components.OracleCoordinator, abi, provider);
  const request = await oracle.getRequest(item.detail.requestId, { blockTag: blockNumber });
  if (request.modelVersion.toLowerCase() !== deployment.modelIdentityHash.toLowerCase()) {
    throw new Error("Request pins a different evaluator");
  }
  return { requestId: String(item.detail.requestId), modelIdentity: request.modelVersion,
    registryVersion: String(request.registryVersion), registryRoot: request.registryRoot };
}

async function run(args) {
  const chainId = Number(args["--network"]);
  const local = Boolean(args["--local"]);
  const isQuote = Boolean(args["--dry-run"]);
  if (!isQuote && !local && (!args["--confirm-public"] || publicKeysDisabled())) {
    throw new Error("Public execution requires --confirm-public and PAIRED_ALLOW_PUBLIC_SENDS=true");
  }
  if (args["--interrupt-after"] && !local) throw new Error("Interruption is a local rehearsal option");
  const { manifest, manifestHash } = readManifest(args["--manifest"]);
  if (local) require("./fixtures").verifyFixtures(manifest);
  const provider = providerFor(process.env.PAIRED_RPC_URL, chainId, local);
  const { data: actors } = readJson(args["--roles"]);
  const sourceCommit = process.env.BLOCK_INSURE_SOURCE_COMMIT;
  try {
    if ((await provider.getNetwork()).chainId !== BigInt(chainId)) throw new Error("RPC answered for a different chain");
    if (!local) configuredRoles.forEach((role) => assertDeploymentSigner(chainId, actors[role]));
    if (isQuote && !args["--plan"]) {
      const quote = await fundingQuote({ manifest, manifestHash, provider, chainId, actors, local });
      const json = JSON.stringify(quote, null, 2) + "\n";
      if (args["--output"]) fs.writeFileSync(args["--output"], json, { flag: "wx" });
      console.log(json.trim());
      return;
    }
    if (!args["--deployment"] || !args["--plan"] || !args["--output"] || !/^[a-f\d]{40}$/i.test(sourceCommit ?? "")) {
      throw new Error("Execution requires deployment, plan, dated output and an explicit source commit");
    }
    const { data: deployment, hash: deploymentManifestHash } = readJson(args["--deployment"]);
    const { data: plan, hash: planHash } = readJson(args["--plan"]);
    if (plan.manifestHash !== manifestHash || plan.chainId !== chainId || plan.sourceCommit !== sourceCommit ||
        plan.deploymentManifestHash !== deploymentManifestHash || configuredRoles.some((role) => actors[role] !== plan.actors?.[role])) {
      throw new Error("Plan provenance does not match this run");
    }
    if (!isQuote && planHash !== args["--reviewed-plan"]) throw new Error("Exact reviewed plan hash is required");
    if (!isQuote && !local) {
      const file = path.resolve(__dirname, "../../deploy/paired-v6-live-routing.json");
      const { data: routing, hash: routingHash } = readJson(file);
      const ids = manifest.operations.map(({ id }) => id);
      const required = routing.manual.sequence.map((id) => ids.indexOf(id));
      if (plan.liveRoutingHash !== routingHash || required.some((position, index) => position < 0 ||
          (index > 0 && position <= required[index - 1]))) {
        throw new Error("Public plan must bind the reviewed live routing sequence and corrected registry publication");
      }
    }
    const readback = await verifyPaired({ manifest, manifestHash, deployment, provider, actors, local });
    const urls = { api: process.env.PAIRED_API_URL, oracle1: process.env.PAIRED_ORACLE_ONE_URL, oracle2: process.env.PAIRED_ORACLE_TWO_URL };
    await waitForReadiness({ urls, deployment: readback, local });
    const items = materialize(manifest, deployment, plan);
    for (const item of items.values()) {
      if ((item.step.category === "bootstrap" || /^setup\.(oracle[12]|auditor[1-4]|bank)$/.test(item.step.id)) && !item.detail.observedHash) {
        throw new Error("Canonical deployment or role-bootstrap receipt missing for " + item.step.id);
      }
    }
    const quote = await planQuote({ provider, items, plan, manifest, chainId, local });
    console.log(JSON.stringify({
      planHash, manifestHash, chainId, maxOutflowByWallet: quote.maxOutflowByWallet, totalOutflowWei: quote.totalOutflowWei,
      recipients: quote.rows,
    }, (_, value) => typeof value === "bigint" ? value.toString() : value, 2));
    if (isQuote) {
      const estimates = [];
      for (const [id, item] of items) {
        if (item.detail.observedHash) { estimates.push({ operationId: id, status: "already recorded" }); continue; }
        try { estimates.push({ operationId: id, gas: String(await provider.estimateGas({ ...item.tx, from: item.from })) }); }
        catch { estimates.push({ operationId: id, status: "selected pre-state does not support an estimate" }); }
      }
      console.log(JSON.stringify(estimates));
      return;
    }
    const planDirectory = path.dirname(path.resolve(args["--plan"]));
    const observationHashes = new Map(manifest.operations.filter((step) => step.kind === "observation").map((step) => [
      step.id, validateObservation({ witness: plan.observations?.[step.id], planDirectory, step, chainId, manifestHash,
        deploymentManifestHash, local }),
    ]));
    if (!local) for (const item of items.values()) {
      if (isServiceTransaction(item.step) && !ethers.isHexString(item.detail.observedHash, 32)) {
        throw new Error("The live service must produce a canonical transaction before adoption of " + item.step.id);
      }
    }
    const output = path.resolve(args["--output"]);
    const campaignPath = path.join(output, "campaign.json");
    if (fs.existsSync(campaignPath)) throw new Error("A completed campaign already exists for this output");
    const forkStart = await captureFork(provider, chainId, { local });
    if (!forkStart.fork) throw new Error("The configured network fork could not be verified");
    const journal = openJournal(output, { type: "run", planHash, manifestHash, sourceCommit, chainId, deploymentManifestHash,
      executionFork: forkStart.executionFork });
    const configuredSigners = Object.fromEntries(configuredRoles.flatMap((role) => {
      const key = process.env["PAIRED_" + role.toUpperCase() + "_PRIVATE_KEY"];
      return key ? [[role, new ethers.Wallet(key)]] : [];
    }));
    const rows = [], finality = [];
    try {
      let previous;
      for (const step of manifest.operations) {
        if (step.kind === "observation") {
          const evidenceSha256 = observationHashes.get(step.id);
          if (!journal.entries.some((entry) => entry.operationId === step.id && entry.type === "observation")) {
            journal.append({ type: "observation", operationId: step.id, evidenceSha256 });
          }
          continue;
        }
        const item = items.get(step.id);
        if (step.category !== "bootstrap" && ["oracle1", "oracle2"].includes(step.role) && item.detail.requestId == null) {
          throw new Error("Missing pinned request identity for " + step.id);
        }
        const settings = {
          chainId, deployment, manifestHash, pollMs: manifest.timing.pollMs, receiptTimeoutMs: 300_000,
          checkBudget: async () => {
            const retained = step.role === "admin" ? amount(manifest.budget.adminRetainedEth, "admin minimum") : 0n;
            const gas = BigInt(item.detail.gasLimit);
            const live = gas * BigInt(plan.fees.maxFeePerGasWei) + await baseComponentCeiling(quote.gasOracle, item, gas);
            if (live > quote.caps.get(step.id)) throw new Error("Base fee components exceed the reviewed ceiling for " + step.id);
            if ((await provider.getBalance(item.from, "pending")) < retained + item.tx.value + quote.caps.get(step.id)) {
              throw new Error("Wallet would cross its spend floor for " + step.id);
            }
          },
        };
        const { canonical, observation, started } = await executeIntent({ provider, item, journal, settings,
          reviewedFees: plan.fees, signer: configuredSigners[step.role], interrupt: args["--interrupt-after"] });
        const operatorFeeWei = !quote.gasOracle || canonical.receipt.operatorFee != null ? null :
          await quote.gasOracle.getOperatorFee(canonical.receipt.gasUsed, { blockTag: canonical.block.number }).catch(() => null);
        const request = await pinnedRequest(item, deployment, provider, canonical.block.number);
        const row = rowFor({ item, canonical, observation, settings, request, operatorFeeWei });
        if (row.transactionIndex == null || (previous && (row.blockNumber < previous.blockNumber ||
            (row.blockNumber === previous.blockNumber && row.transactionIndex <= previous.transactionIndex)))) {
          throw new Error("Canonical transaction order differs from the scenario at " + step.id);
        }
        rows.push(row);
        previous = row;
        const observedFinality = journal.entries.find((entry) => entry.type === "finality" && entry.operationId === step.id);
        if (observedFinality) row.observedFinalityUpperMs = observedFinality.upperMs;
        if (!observedFinality && started !== undefined) {
          finality.push(waitFor(async () => {
            const block = await provider.getBlock("finalized");
            if (!block || block.number < row.blockNumber) return false;
            if ((await provider.getBlock(row.blockNumber))?.hash !== row.blockHash) throw new Error("Finalized receipt moved");
            return Math.round(performance.now() - started);
          }, Date.now() + 40 * 60_000, manifest.timing.pollMs).then((upperMs) => {
            row.observedFinalityUpperMs = upperMs;
            journal.append({ type: "finality", operationId: step.id, upperMs });
          }).catch(() => { row.observedFinalityUpperMs = null; }));
        }
        if (row.status !== "confirmed") break;
      }
      await Promise.all(finality);
      const forkEnd = await captureFork(provider, chainId, { local });
      fs.writeFileSync(campaignPath, JSON.stringify({
        schema: "block-insure-paired-campaign/v1", sourceCommit, chainId, local, manifestHash, deploymentManifestHash,
        configurationHash: readback.configurationHash, componentAddresses: readback.components,
        runtimeCodeHashes: readback.codeHashes, normalizedRuntimeCodeHashes: readback.normalizedCodeHashes,
        timing: manifest.timing, expectedTransactionCount: manifest.expectedTransactionsPerChain,
        fork: { start: forkStart, end: forkEnd },
        complete: forkStart.executionFork === forkEnd.executionFork &&
          rows.length === manifest.expectedTransactionsPerChain && rows.every((row) => row.status === "confirmed"), rows,
      }, null, 2) + "\n", { flag: "wx" });
    } finally {
      await Promise.allSettled(finality);
      journal.close();
    }
  } finally { provider.destroy(); }
}

if (require.main === module) {
  const args = parseOperatorArguments(process.argv.slice(2), {
    values: ["--network", "--manifest", "--roles", "--plan", "--deployment", "--output", "--reviewed-plan", "--interrupt-after"],
    switches: ["--dry-run", "--local", "--confirm-public"],
    required: ["--network", "--manifest", "--roles"],
  });
  run(args).catch((error) => {
    console.error(error.code || (error instanceof Error && error.message && !/https?:|0x[a-f\d]{64,}/i.test(error.message)
      ? error.message : "Paired run failed. Inspect the private operator context and operation journal."));
    process.exitCode = 1;
  });
}
module.exports = { planQuote, run, validateObservation };

