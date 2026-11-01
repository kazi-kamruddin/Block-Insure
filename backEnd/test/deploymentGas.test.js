const test = require("node:test"), assert = require("node:assert/strict");
const { estimateDeploymentGas } = require("../../scripts/deploymentGas");

test("Sepolia state-heavy creation estimates retain total gas above the old execution cap", async () => {
  let request;
  const provider = { getBlock: async () => ({ gasLimit: 200000000n }), estimateGas: async (tx) => { request = tx; return 75000000n; } };
  const result = await estimateDeploymentGas({ provider, chainId: 11155111, transaction: { data: "0x60" }, from: "synthetic" });
  assert.equal(request.gasLimit, 200000000n);
  assert.equal(result.estimatedGas, 75000000n);
  assert.equal(result.gasLimit, 82505000n);
  assert.match(result.accounting, /PLUS_STATE/);
});

test("Base deployment budgets and margin fail closed without silently clipping an estimate", async () => {
  let budget;
  const provider = { getBlock: async () => ({ gasLimit: 120000000n }), estimateGas: async (tx) => { budget = tx.gasLimit; return 10000000n; } };
  const quote = await estimateDeploymentGas({ provider, chainId: 84532, transaction: {}, from: "synthetic" });
  assert.equal(budget, 16777216n);
  assert.equal(quote.gasLimit, 11005000n);
  provider.estimateGas = async () => 16700000n;
  await assert.rejects(estimateDeploymentGas({ provider, chainId: 84532, transaction: {} }), /exceeds/);
  await assert.rejects(estimateDeploymentGas({ provider, chainId: 1, transaction: {} }), /supported public testnet/);
});
