const test = require("node:test"), assert = require("node:assert/strict");
const { comparableCode, verifyDeployment } = require("../../scripts/deploymentReadback");
test("deployment comparison ignores only declared immutable bytes and detects executable changes", () => {
  const refs = { owner: [{ start: 1, length: 2 }] };
  assert.equal(comparableCode("0x60112200", refs), comparableCode("0x60334400", refs));
  assert.notEqual(comparableCode("0x60112200", refs), comparableCode("0x61112200", refs));
  assert.throws(() => comparableCode("0x60", refs), /immutable reference/);
});
test("deployment readback rejects a wrong network before reading code or contract state", async () => {
  await assert.rejects(verifyDeployment({ manifest: { chainId: "11155111" }, provider: { getNetwork: async () => ({ chainId: 31337n }) } }), /network mismatch/);
});

test("bootstrap validation rejects network confusion, local seed signers and unreviewed initial amounts", () => {
  const { Wallet } = require("ethers");
  const { validateBootstrap } = require("../../scripts/deployTestnet");
  const environment = { CHAIN_ID: "11155111", SEPOLIA_RPC_URL: "https://rpc.example.test", ADMIN_PRIVATE_KEY: Wallet.createRandom().privateKey,
    INITIAL_POLICY_PREMIUM_ETH: "0.0001", INITIAL_POLICY_COVERAGE_ETH: "0.005", INITIAL_BENEFITS_RESERVE_ETH: "0.002" };
  assert.equal(validateBootstrap("sepolia", environment).chainId, 11155111);
  assert.throws(() => validateBootstrap("baseSepolia", environment));
  assert.throws(() => validateBootstrap("sepolia", { ...environment, INITIAL_BENEFITS_RESERVE_ETH: "0" }), /positive reviewed/);
  const mnemonic = require("../../contracts/node_modules/hardhat/internal/core/config/default-config").HARDHAT_NETWORK_MNEMONIC;
  assert.throws(() => validateBootstrap("sepolia", { ...environment, ADMIN_PRIVATE_KEY: Wallet.fromPhrase(mnemonic).privateKey }), /dedicated public-testnet signer/);
});
