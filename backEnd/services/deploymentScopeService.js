const { getProvider, getContractAddress } = require("./contractService");

// The creation-block hash distinguishes local chain resets that reuse chainId,
// contract address and bytecode. Never join a fresh policy #1 to an older #1.
const getDeploymentScope = async () => {
  const provider = getProvider();
  const address = getContractAddress().toLowerCase();
  const number = Number(process.env.CONTRACT_DEPLOYMENT_BLOCK);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error("CONTRACT_DEPLOYMENT_BLOCK is required for deployment identity");
  const [network, block, code] = await Promise.all([provider.getNetwork(), provider.getBlock(number), provider.getCode(address, number)]);
  if (process.env.CHAIN_ID && network.chainId !== BigInt(process.env.CHAIN_ID)) throw new Error("RPC chain differs from the configured deployment chain");
  if (!block?.hash || code === "0x") throw new Error("Configured deployment block has no manager contract");
  return `${network.chainId}:${address}:${block.hash.toLowerCase()}`;
};
module.exports = { getDeploymentScope };
