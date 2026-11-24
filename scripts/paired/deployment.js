const { formatEther, id, getAddress } = require("../../backEnd/node_modules/ethers");
const { verifyDeployment } = require("../deploymentReadback");
const { estimateDeploymentGas } = require("../deploymentGas");
const { amount, digest } = require("./manifest");
const { captureFork } = require("./fork");

const normalize = (value) => JSON.stringify(value, (_, field) => typeof field === "bigint" ? field.toString() : field);
const abi = (name) => require("../../contracts/artifacts/contracts/" + name + ".sol/" + name + ".json").abi;
const { Contract } = require("../../backEnd/node_modules/ethers");

function environmentForDeployment(configuration) {
  const model = require("../../oracle/runtimeProtocol").loadProtocolArtifact();
  if (configuration.modelIdentity !== model.modelIdentityHash) throw new Error("Paired run must use the frozen default");
  return {
    CLAIM_WORKFLOW_PROFILE: configuration.claimWorkflowProfile,
    CALENDAR_PROFILE: configuration.calendarProfile,
    REVIEW_TIMING_PROFILE: configuration.reviewTimingProfile,
    INITIAL_POLICY_PREMIUM_ETH: configuration.premiumEth,
    INITIAL_POLICY_COVERAGE_ETH: configuration.coverageEth,
    INITIAL_BENEFITS_RESERVE_ETH: configuration.refundReserveEth,
  };
}

async function verifyPaired({ manifest, manifestHash, deployment, provider, actors, local, bootstrap = false }) {
  if (deployment.pairedManifestHash !== manifestHash) throw new Error("Deployment manifest does not bind the reviewed paired configuration");
  const spec = manifest.deployment;
  const result = await verifyDeployment({ manifest: deployment, provider, local, paired: true, bootstrap, requireRegistry: false });
  const read = (name, implementation = name) => new Contract(result.components[name], abi(implementation), provider);
  const manager = read("InsuranceManager"), economics = read("PolicyEconomics");
  const panel = read("ClaimAdjudicator", "ClaimAdjudicatorV6");
  const [offer, ruleSet, surgeryLimit, timing, bank, refundTerms] = await Promise.all([
    manager.getPolicyPackage(1),
    economics.getPackageRules(1, 1),
    economics.serviceSublimit(1, 1, id("SURGERY")),
    Promise.all([panel.preparationDuration(), panel.reviewDuration(), panel.routingDelay(), panel.reasonedVotingRequired()]),
    read("BankIdentityRegistry").bankWalletByIdHash(id("BANK-001")),
    read("PolicyBenefitsManager").getBenefitTerms(1),
  ]);
  const rules = ruleSet[0];
  const timingProof = timing.map(String);
  if (result.claimWorkflowProfile !== spec.claimWorkflowProfile || result.paymentSchedule.profile !== spec.calendarProfile ||
      result.modelIdentityHash !== spec.modelIdentity || !offer.isActive ||
      offer.premiumAmount !== amount(spec.premiumEth, "premium") || offer.coverageAmount !== amount(spec.coverageEth, "coverage") ||
      rules.maximumClaimWei !== offer.coverageAmount || rules.deductibleRateBps !== BigInt(spec.deductibleBps) ||
      rules.insurerShareBps !== BigInt(spec.insurerShareBps) || rules.settlementFormulaVersion !== id("BLOCK_INSURE_SETTLEMENT_V2") ||
      surgeryLimit !== amount(spec.surgerySublimitEth, "surgery limit") || timingProof.join(",") !== "600,600,900,true") {
    throw new Error("Paired runtime configuration or policy terms do not match");
  }
  if (!bootstrap) {
    const roleMatch = (actual, names) => Array.isArray(actual) && actual.length === names.length &&
      actual.every((address, index) => getAddress(address) === getAddress(actors[names[index]]));
    if (!roleMatch(result.oracleWallets, ["oracle1", "oracle2"]) ||
        !roleMatch(result.auditorWallets, ["auditor1", "auditor2", "auditor3", "auditor4"]) ||
        getAddress(bank) !== getAddress(actors.bank) ||
        !await manager.hasRole(id("ADMIN_ROLE"), actors.admin)) throw new Error("Paired runtime roles or registry do not match");
  }
  const configurationHash = digest(normalize({
    manifestHash, runtime: result.normalizedCodeHashes, calendar: result.paymentSchedule, model: result.modelIdentityHash,
    timing: timingProof, offer: Array.from(offer), rules: ruleSet.map((part) => Array.from(part)),
    surgeryLimit, refund: Array.from(refundTerms), roles: bootstrap ? "bootstrap" : ["oracle1", "oracle2", "auditor1", "auditor2", "auditor3", "auditor4", "bank", "admin"],
  }));
  return { ...result, configurationHash };
}

function assertParity(l1, l2) {
  if (l1.chainId === l2.chainId || l1.configurationHash !== l2.configurationHash ||
      normalize(l1.normalizedCodeHashes) !== normalize(l2.normalizedCodeHashes)) throw new Error("Paired deployments differ");
}

async function fundingQuote({ manifest, manifestHash, provider, chainId, actors, local }) {
  const [block, gasPrice] = await Promise.all([provider.getBlockNumber(), provider.send("eth_gasPrice", [])]);
  const fork = await captureFork(provider, chainId, { local, at: block });
  const balances = await Promise.all(Object.entries(actors).map(async ([role, address]) =>
    [role, getAddress(address), await provider.getBalance(address, block)]));
  const floors = manifest.budget.walletFloorsEth;
  const wallets = balances.map(([role, address, balance]) => {
    const floor = floors[role] ? amount(floors[role], role) : 0n;
    const topUp = floor > balance ? floor - balance : 0n;
    return { role, address, balanceEth: formatEther(balance), floorEth: formatEther(floor), topUpEth: formatEther(topUp) };
  });
  if (!wallets.some((row) => row.role === "admin") || Object.keys(floors).some((role) => !actors[role])) throw new Error("Missing funding role address");
  const topUps = wallets.filter((row) => row.topUpEth !== "0.0");
  const totalTransfers = topUps.reduce((total, row) => total + amount(row.topUpEth, row.role), 0n);
  const reserve = amount(manifest.budget.adminRetainedEth, "admin retained");
  const maximum = totalTransfers + amount(manifest.deployment.medicalReserveEth, "medical") +
    amount(manifest.deployment.refundReserveEth, "refund") + amount(manifest.budget.feeCeilingEth, "fee");
  const adminBalance = balances.find(([role]) => role === "admin")[2];
  const artifact = require("../../contracts/artifacts/contracts/AcceleratedInsuranceManager.sol/AcceleratedInsuranceManager.json");
  const transaction = { data: artifact.bytecode };
  let managerGas;
  try {
    const estimate = local ? { estimatedGas: await provider.estimateGas({ ...transaction, from: actors.admin }) }
      : await estimateDeploymentGas({ provider, chainId, transaction, from: actors.admin });
    managerGas = { estimatedGas: String(estimate.estimatedGas), gasLimit: estimate.gasLimit?.toString() ?? null,
      quotedExecutionFeeWei: String(estimate.estimatedGas * BigInt(gasPrice)), status: "estimated" };
  } catch { managerGas = { status: "unavailable from selected RPC" }; }
  let baseFeeComponents = null;
  if (!local && chainId === 84532) {
    const oracle = new Contract("0x420000000000000000000000000000000000000F",
      ["function getL1FeeUpperBound(uint256) view returns(uint256)", "function getOperatorFee(uint256) view returns(uint256)"], provider);
    const estimates = await Promise.allSettled([oracle.getL1FeeUpperBound(256, { blockTag: block }), oracle.getOperatorFee(21000, { blockTag: block })]);
    baseFeeComponents = { transferDataFeeUpperWei: estimates[0].status === "fulfilled" ? String(estimates[0].value) : null,
      transferOperatorFeeWei: estimates[1].status === "fulfilled" ? String(estimates[1].value) : null };
  }
  return {
    schema: "block-insure-paired-funding-quote/v1", manifestHash, chainId, block, sampledAt: new Date().toISOString(),
    gasPriceWei: BigInt(gasPrice).toString(), fork, managerGas, baseFeeComponents, wallets,
    topUpTotalEth: formatEther(totalTransfers), medicalReserveEth: manifest.deployment.medicalReserveEth,
    refundReserveEth: manifest.deployment.refundReserveEth, feeCeilingEth: manifest.budget.feeCeilingEth,
    minimumAdminRetainedEth: formatEther(reserve), maxAdminOutflowEth: formatEther(maximum),
    adminRemainingEth: formatEther(adminBalance - maximum), budgetFits: adminBalance >= maximum + reserve,
    plannedTransactions: manifest.expectedTransactionsPerChain, walletTopUps: topUps.length,
    totalTransactions: manifest.expectedTransactionsPerChain + topUps.length,
    limitation: "Estimates cover the manager creation and funding caps. Workflow gas requires the matching V6 pre-state.",
  };
}

module.exports = { assertParity, environmentForDeployment, fundingQuote, verifyPaired };

