const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("../../backEnd/node_modules/ethers");
const { amount, digest } = require("./manifest");
const { capturedBootstrap } = require("./publicBootstrap");
const { captureFork } = require("./fork");
const { localAdapter } = require("./localAdapter");
const { createEvidenceFixtures } = require("./localFixtures");
const { privateCheckpoint } = require("./privateCheckpoint");
const { configuredRoles } = require("./runner");

const adminWallet = "0xd388BB1572CDb7F7dB2bb485a1051749F9B1ff1E";
const oracleABI = ["function getL1FeeUpperBound(uint256) view returns(uint256)", "function getOperatorFee(uint256) view returns(uint256)"];
const feeOracle = (provider, chainId) => chainId === 84532
  ? new ethers.Contract("0x420000000000000000000000000000000000000F", oracleABI, provider) : null;

function campaignSigners() {
  const read = (file) => require("../../backEnd/node_modules/dotenv").parse(fs.readFileSync(path.resolve(__dirname, "../../deploy", file)));
  const legacy = read("base-sepolia.acceptance.env");
  const measured = read("paired-campaign-oracles.env");
  const signers = Object.fromEntries(Object.entries({ admin: legacy.ADMIN_PRIVATE_KEY, holder: legacy.POLICYHOLDER_PRIVATE_KEY,
    bank: legacy.BANK_PRIVATE_KEY, oracle1: measured.PAIRED_ORACLE1_PRIVATE_KEY, oracle2: measured.PAIRED_ORACLE2_PRIVATE_KEY,
    auditor1: legacy.AUDITOR_PRIVATE_KEY, auditor2: legacy.AUDITOR_PRIVATE_KEY_2,
    auditor3: legacy.AUDITOR_PRIVATE_KEY_3, auditor4: legacy.AUDITOR_PRIVATE_KEY_4 }).map(([role, key]) => [role, new ethers.Wallet(key)]));
  const hosted = [legacy.ORACLE_ONE_PRIVATE_KEY, legacy.ORACLE_TWO_PRIVATE_KEY].map((key) => new ethers.Wallet(key).address);
  const actors = Object.fromEntries(Object.entries(signers).map(([role, signer]) => [role, signer.address]));
  if (actors.admin !== adminWallet || new Set([...Object.values(actors), ...hosted]).size !== configuredRoles.length + 2) {
    throw new Error("Public campaign identities overlap or use the wrong admin");
  }
  return { signers, actors, hosted };
}

async function verifySpendingPlan({ manifest, plan, provider, chainId, actors }) {
  const uint = (v, name) => {
    if (typeof v !== "string" || !/^\d+$/.test(v)) throw new Error("Missing reviewed budget field " + name);
    return BigInt(v);
  };
  const start = uint(plan.startingAdminWei, "starting balance");
  const retained = uint(plan.retainedAdminWei, "retained floor");
  const ceiling = uint(plan.maxAdminOutflowWei, "maximum outflow");
  const [openingBalance, block] = await Promise.all([provider.getBalance(actors.admin, plan.preflightBlock), provider.getBlock(plan.preflightBlock)]);
  if (block?.hash !== plan.preflightBlockHash || openingBalance !== start || retained !== (start + 9n) / 10n || ceiling > start - retained ||
      (chainId === 84532 && ceiling * 5n > (start - retained) * 4n)) throw new Error("Campaign exceeds the reviewed ceiling or 20% Base margin");
  const price = uint(plan.fees.maxFeePerGasWei, "fee cap");
  const tip = uint(plan.fees.priorityWei, "priority fee");
  if (price === 0n || tip > price) throw new Error("Invalid EIP-1559 fee caps");
  const oracle = feeOracle(provider, chainId);
  const caps = new Map();
  for (const step of manifest.operations.filter((item) => item.kind === "transaction")) {
    const limit = uint(plan.gasLimits[step.id], step.id);
    const extra = uint(plan.extraFeeLimits[step.id], step.id);
    if (limit === 0n || (!oracle && extra !== 0n)) throw new Error("Invalid operation fee ceiling " + step.id);
    caps.set(step.id, { gas: limit, value: amount(step.valueEth, step.id), extra, step });
  }
  const spendBy = (role) => [...caps.values()].filter(({ step }) => step.role === role)
    .reduce((sum, cap) => sum + cap.gas * price + cap.value + cap.extra, 0n);
  const transfer = uint(plan.transferGasLimit, "funding gas limit") * price + uint(plan.transferFeeLimit, "funding fee ceiling");
  const funding = await Promise.all(configuredRoles.filter((role) => role !== "admin").map(async (role) => {
    const row = plan.funding[role];
    const balance = uint(row.balanceWei, role + " preflight balance");
    const cap = spendBy(role);
    const target = (cap * 110n + 99n) / 100n;
    const topUp = target > balance ? target - balance : 0n;
    if (row.wallet !== actors[role] || target !== uint(row.targetWei, role + " fund target") ||
        cap !== uint(row.expenseCapWei, role + " expense cap") || topUp !== uint(row.topUpWei, role + " top-up") ||
        balance !== await provider.getBalance(row.wallet, plan.preflightBlock)) throw new Error("Funding plan differs from its bound balances and operations");
    return topUp > 0n ? topUp + transfer : 0n;
  }));
  const cleanupBudget = uint(plan.hostedSmokeAndHandoverWei, "hosted acceptance reservation");
  if ((chainId === 84532 ? cleanupBudget !== ethers.parseEther("0.004") : cleanupBudget !== 0n) ||
      spendBy("admin") + cleanupBudget + funding.reduce((left, right) => left + right, 0n) !== ceiling) {
    throw new Error("Reviewed maximum does not reconcile to the funding and operation ceilings");
  }
  async function maximumOutflow(item) {
    const cap = caps.get(item.step.id);
    if (!cap || cap.gas !== BigInt(item.detail.gasLimit) || item.tx.value !== cap.value || actors[item.step.role] !== item.from) {
      throw new Error("Transaction differs from its reviewed budget binding");
    }
    const extra = oracle ? await oracle.getL1FeeUpperBound((item.tx.data.length - 2) / 2 + 512) + await oracle.getOperatorFee(cap.gas) : 0n;
    if (extra > cap.extra) throw new Error("Current Base fee components exceed the reviewed cap");
    return cap.gas * price + cap.value + cap.extra;
  }
  return {
    retained, ceiling, price, caps, maximumOutflow,
    async checkBudget(item) {
      const cap = await maximumOutflow(item);
      const available = await provider.getBalance(item.from, "pending");
      const floor = item.step.role === "admin" ? retained : 0n;
      if (available < floor + cap || (item.step.role === "admin" && start - available + cap > ceiling)) {
        throw new Error("Transaction would breach the reviewed public wallet floor or maximum outflow");
      }
    },
    async checkRepetition(repetition, ledger) {
      const confirmed = new Set(ledger.entries.filter(({ type }) => type === "receipt").map(({ operationId }) => operationId));
      const remaining = [...caps.values()].filter(({ step }) => step.repetition === repetition && step.role === "admin" && !confirmed.has(step.id))
        .reduce((sum, cap) => sum + cap.gas * price + cap.value + cap.extra, 0n);
      const balance = await provider.getBalance(actors.admin, "pending");
      if (balance < retained + remaining || start - balance + remaining > ceiling) throw new Error("Repetition would breach the reviewed cap or floor");
    },
    operatorFee: (canonical) => oracle && canonical.receipt.operatorFee == null ?
      oracle.getOperatorFee(canonical.receipt.gasUsed, { blockTag: Number(canonical.block.number) }) : null,
  };
}

async function runGeneratedPublic({ provider, manifest, manifestHash, deployment, deploymentManifestHash, readback, chainId,
  sourceCommit, actors, plan, planHash, output, routing, signers, budget, mongoUri }) {
  const registryTime = Number(plan.registryReferenceTime);
  if (!Number.isInteger(registryTime) || registryTime < 1700000000) throw new Error("Shared registry reference time is missing");
  const forkStart = await captureFork(provider, chainId);
  if (!forkStart.fork) throw new Error("Current public fork is unverified");
  const allReceipts = await capturedBootstrap({ provider, manifest, manifestHash, chainId, deployment, plan, output, budget });
  const outputPath = path.join(output, "campaign.json");
  if (fs.existsSync(outputPath)) throw new Error("Campaign has already completed");
  const checkpoint = privateCheckpoint(path.join(output, "workflow", "private"), signers.admin.privateKey, deploymentManifestHash);
  const campaignRoot = path.dirname(output);
  const evidenceState = privateCheckpoint(path.join(campaignRoot, "shared-evidence"), signers.admin.privateKey, digest(JSON.stringify({ registryTime, sourceCommit, manifestHash })));
  const evidence = createEvidenceFixtures(["holder", "auditor1", "auditor2", "auditor3", "auditor4"], evidenceState);
  const result = await localAdapter({ provider, deployment, deploymentManifestHash, manifest, manifestHash, chainId, signers, evidence,
    directory: output, startTime: registryTime, routing, readback, mongoUri, checkpoint,
    publicSettings: { planHash, gasLimits: plan.gasLimits, fees: plan.fees, checkBudget: budget.checkBudget,
      checkRepetition: budget.checkRepetition, operatorFee: budget.operatorFee } });
  const rows = [...allReceipts, ...result.rows];
  const forkEnd = await captureFork(provider, chainId);
  if (rows.length !== manifest.expectedTransactionsPerChain || forkStart.executionFork !== forkEnd.executionFork) {
    throw new Error("Public campaign operation count or execution fork differed");
  }
  const campaign = { schema: "block-insure-paired-campaign/v1", local: false, chainId, sourceCommit, manifestHash, deploymentManifestHash,
    planHash, configurationHash: readback.configurationHash, offchainInputSource: manifest.offchainInputSource, repetitions: manifest.repetitions,
    complete: true, fork: { start: forkStart, end: forkEnd }, observations: result.observations, oracleHandoff: result.oracleHandoff,
    componentAddresses: readback.components, runtimeCodeHashes: readback.codeHashes, normalizedRuntimeCodeHashes: readback.normalizedCodeHashes, rows };
  fs.writeFileSync(outputPath, JSON.stringify(campaign, null, 2) + "\n", { flag: "wx" });
  return campaign;
}

module.exports = { adminWallet, campaignSigners, runGeneratedPublic, verifySpendingPlan };
