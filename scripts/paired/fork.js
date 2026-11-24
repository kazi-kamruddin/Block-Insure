const { toQuantity } = require("../../backEnd/node_modules/ethers");

const AMSTERDAM_ACTIVATION = 1791294816;
const DENIM_SEPOLIA_ACTIVATION = 1792605600;
const amsterdamEips = [2780, 7495, 7688, 7708, 7732, 7778, 7843, 7916, 7928, 7954,
  7976, 7981, 7997, 8024, 8037, 8038, 8045, 8061, 8246, 8282];
const publicRules = {
  11155111: { fork: "Glamsterdam", executionFork: "Amsterdam", activationTime: AMSTERDAM_ACTIVATION,
    upgradeEips: amsterdamEips, executionGasCap: "16777216", totalGasCap: "4294967295",
    pricingEips: [2780, 7825, 7976, 8037, 8038], source: "https://eips.ethereum.org/EIPS/eip-7773" },
  84532: { fork: "Denim", executionFork: "Osaka with Base rules", activationTime: DENIM_SEPOLIA_ACTIVATION,
    pricingEips: [1559, 2200, 2929, 3860, 7623, 7825], source: "https://github.com/base/base/releases/tag/v1.5.1",
    rollupRules: "https://docs.base.org/specifications/transactions/network-fees" },
};

async function captureFork(provider, chainId, { local = false, at = "latest" } = {}) {
  const block = await provider.send("eth_getBlockByNumber", [typeof at === "number" ? toQuantity(at) : at, false]);
  if (!block?.hash || (await provider.getNetwork()).chainId !== BigInt(chainId)) throw new Error("Fork observation chain or block mismatch");
  const timestamp = Number(BigInt(block.timestamp));
  const observed = { block: Number(BigInt(block.number)), blockHash: block.hash, timestamp,
    blockGasLimit: String(BigInt(block.gasLimit)) };
  if (local) {
    if (!/hardhat/i.test(await provider.send("web3_clientVersion", []))) throw new Error("Local fork identity requires Hardhat");
    return { ...observed, fork: "Cancun", executionFork: "Cancun", source: "contracts/hardhat.config.js",
      pricingEips: [1559, 2200, 2929, 3860] };
  }
  const rules = publicRules[chainId];
  if (!rules) throw new Error("No reviewed public fork information for this chain");
  const config = await provider.send("eth_config", []).then((value) => value?.current).catch(() => null);
  const amsterdamHeader = Boolean(block.blockAccessListHash && block.slotNumber != null);
  const forkMatches = timestamp >= rules.activationTime &&
    (chainId === 11155111 ? amsterdamHeader : !amsterdamHeader) &&
    (!config || chainId !== 11155111 || config.activationTime === rules.activationTime);
  if (!forkMatches) {
    return { ...observed, fork: null, executionFork: null, forkId: config?.forkId ?? null,
      source: rules.source, reason: "Block or RPC fork identity differs from the reviewed activation" };
  }
  return { ...observed, ...rules, forkId: config?.forkId ?? null,
    evidence: chainId === 11155111 ? "Canonical header with block access list hash and slot number" : "Base release schedule at canonical block timestamp" };
}

module.exports = { captureFork };
