// Public testnets do not share one gas model. Never infer public gas from Hardhat.
async function estimateDeploymentGas({ provider, chainId, transaction, from }) {
  const id = BigInt(chainId);
  if (![11155111n, 84532n].includes(id)) throw new Error("Select a supported public testnet for deployment estimation");
  const block = await provider.getBlock("latest");
  if (!block || block.gasLimit <= 0n) throw new Error("Current network gas budget unavailable");
  // Sepolia's EIP-8037 total budget includes state gas beyond EIP-7825's
  // execution budget. Base Sepolia retains its own execution/fee schedule.
  const ceiling = id === 11155111n ? 4294967295n : 16777216n;
  const totalBudget = block.gasLimit < ceiling ? block.gasLimit : ceiling;
  const estimatedGas = await provider.estimateGas({ ...transaction, from, gasLimit: totalBudget });
  const gasLimit = (estimatedGas * 110n + 99n) / 100n + 5000n;
  if (estimatedGas <= 0n || gasLimit > totalBudget) throw new Error("Estimated deployment plus margin exceeds the current total budget");
  return { estimatedGas, gasLimit, totalBudget,
    accounting: id === 11155111n ? "SEPOLIA_EXECUTION_PLUS_STATE_GAS" : "BASE_SEPOLIA_EXECUTION_GAS_DATA_FEES_SEPARATE" };
}
module.exports = { estimateDeploymentGas };
