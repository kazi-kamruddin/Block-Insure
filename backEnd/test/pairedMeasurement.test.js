const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ethers } = require("ethers");
const { digest, readManifest, validateManifest } = require("../../scripts/paired/manifest");
const { verifyFixtures } = require("../../scripts/paired/fixtures");
const { classifyDiscrepancy, compare, measured, projected, timing } = require("../../scripts/paired/compare");
const { decodeEnvelope, normalize } = require("../../scripts/paired/receipt");
const { snapshot } = require("../../scripts/paired/pricing");
const { captureFork } = require("../../scripts/paired/fork");
const { executeIntent, openJournal, operationFingerprint } = require("../../scripts/paired/runner");
const { validateReadiness } = require("../../scripts/paired/readiness");
const { validateObservation } = require("../../scripts/paired/run");
const { isServiceTransaction } = require("../../scripts/paired/serviceReceipts");

const scenario = readManifest(path.resolve(__dirname, "../../deploy/paired-v6-scenario.json"));
const { manifestHash } = scenario;
const step = { id: "premium.paid", role: "holder", category: "premium", method: "payPremium", kind: "transaction" };
const row = (id = step.id) => ({
  operationId: id, signerRole: step.role, function: step.method, category: step.category,
  operationFingerprint: "same policy and installment", valueWei: "10000", manifestHash,
  transactionHash: ethers.id(id), status: "confirmed", gasUsed: "100", executionFeeWei: "200",
  l1DataFeeWei: "15", operatorFeeWei: "0", unsignedBytes: 120,
});
const campaign = (rows, chainId) => ({ local: false, rows: rows.map((r) => ({ ...r, chainId })), chainId, manifestHash,
  sourceCommit: "a".repeat(40), configurationHash: "b".repeat(64) });

test("approved amounts retain their pinned frozen routes and fixture scores", () => {
  const verified = verifyFixtures(scenario.manifest);
  assert.equal(verified.routine.route, "AUTO");
  assert.equal(verified.manual.scoreUnits, 165616852);
  assert.equal(verified.surgery.route, "AUTO");
  assert.equal(verified.manual.oodWarning, false);
});
test("manifest rejects mismatched counts and reserves beyond approval", () => {
  const copy = structuredClone(scenario.manifest);
  copy.expectedTransactionsPerChain += 1;
  assert.throws(() => validateManifest(copy), /operation count/);
  copy.expectedTransactionsPerChain -= 1;
  copy.deployment.medicalReserveEth = "1";
  assert.throws(() => validateManifest(copy), /financial limits/);
});
test("only matching and successful operations enter gas ratios and fee shares", () => {
  const failed = { ...step, id: "failed" }, missing = { ...step, id: "missing" }, wrong = { ...step, id: "wrong" };
  const l1 = campaign([row(), row("failed"), row("missing"), row("wrong")], 11155111);
  const l2 = campaign([{ ...row(), gasUsed: "80" }, { ...row("failed"), status: "reverted" },
    { ...row("wrong"), signerRole: "admin" }], 84532);
  const report = compare({ operations: [step, failed, missing, wrong] }, manifestHash, l1, l2);
  assert.equal(report.workflowTotals.n, 1);
  assert.equal(report.workflowTotals.gasRatio, 1.25);
  assert.equal(report.paired[0].discrepancy.reason, "unexplained");
  assert.equal(report.paired[0].l1MeasuredFeeShare, 0.02);
  assert.equal(report.paired[0].l2MeasuredFeeShare, 0.0215);
  assert.equal(report.excluded.length, 3);
});
test("unknown Base fee component is preserved and Base projection binds the canonical unsigned size", () => {
  assert.equal(measured({ ...row(), l1DataFeeWei: null }, true, false), null);
  assert.equal(measured({ ...row(), operatorFeeWei: null }, true, false), null);
  const quote = { block: 123, basis: "GasPriceOracle.getL1Fee(unsignedEnvelope)", unsignedBytes: 120,
    l1DataFeeWei: "33", operatorFeeWei: "0" };
  const pricing = { base: { executionPriceWei: "4", block: 123, transactionQuotes: { [row().transactionHash]: quote } } };
  assert.equal(projected(row(), "base", pricing), 433n);
  assert.equal(projected({ ...row(), unsignedBytes: 121 }, "base", pricing), null);
});
test("a fixed mainnet fee window excludes the next-block fee and pins both endpoint hashes", async () => {
  const first = { number: 18, hash: ethers.id("first"), timestamp: 1700000000, baseFeePerGas: 200n };
  const last = { number: 21, hash: ethers.id("last"), timestamp: 1700000036, baseFeePerGas: 800n };
  const provider = {
    async getNetwork() { return { chainId: 1n }; },
    async getBlock(block) { return block === "finalized" ? last : block === 18 ? first : null; },
    async send(method, params) {
      assert.deepEqual([method, params], ["eth_feeHistory", ["0x4", "0x15", []]]);
      return { oldestBlock: "0x12", baseFeePerGas: [200, 600, 400, 800, 10_000].map(ethers.toQuantity) };
    },
  };
  const price = await snapshot(provider, 1, "https://ethereum.org/developers/docs/gas/", 4);
  assert.equal(price.executionPriceWei, "500");
  assert.deepEqual(price.window, { startBlock: 18, startHash: first.hash, endBlock: 21, baseFeesWei: ["200", "600", "400", "800"] });
  assert.equal(price.blockHash, last.hash);
  last.baseFeePerGas += 1n;
  await assert.rejects(snapshot(provider, 1, "https://ethereum.org/developers/docs/gas/", 4), /anchored block/);
});
test("a fixed projection snapshot prices both chains and propagates any missing Base component", () => {
  const [a, b] = [campaign([row()], 11155111), campaign([row()], 84532)];
  const snapshot = { manifestHash, ethereum: { chainId: 1, block: 123, source: "https://ethereum.org", observedAt: "2026-11-24T01:00:00Z", executionPriceWei: "10" },
    base: { chainId: 8453, block: 456, source: "https://docs.base.org", observedAt: "2026-11-24T01:00:00Z", executionPriceWei: "5",
      transactionQuotes: { [row().transactionHash]: { block: 456, unsignedBytes: 120,
        basis: "GasPriceOracle.getL1Fee(unsignedEnvelope)", l1DataFeeWei: "30", operatorFeeWei: "2" } } } };
  const run = () => compare({ operations: [step] }, manifestHash, a, b, { pricing: snapshot }).paired[0];
  assert.deepEqual([run().l1ProjectedFeeWei, run().l2ProjectedFeeWei, run().l2ProjectedFeeShare], ["1000", "532", 0.0532]);
  snapshot.base.transactionQuotes[row().transactionHash].operatorFeeWei = null;
  assert.equal(run().l2ProjectedFeeWei, null);
});
test("fork proof distinguishes Amsterdam gas rules from local Cancun and gas classifications require evidence", async () => {
  const ruleBlock = { number: "0x123", hash: ethers.id("block"), timestamp: ethers.toQuantity(1795518504),
    gasLimit: ethers.toQuantity(199804689), blockAccessListHash: ethers.id("access"), slotNumber: "0x99" };
  const provider = { async getNetwork() { return { chainId: 11155111n }; },
    async send(method) { return method === "eth_getBlockByNumber" ? ruleBlock : method === "web3_clientVersion" ? "HardhatNetwork" : { current: { activationTime: 1791294816, forkId: "0x6c1d9423" } }; } };
  const chain = await captureFork(provider, 11155111);
  assert.deepEqual([chain.executionFork, chain.executionGasCap, chain.totalGasCap], ["Amsterdam", "16777216", "4294967295"]);
  assert.equal((await captureFork(provider, 11155111, { local: true })).executionFork, "Cancun");
  delete ruleBlock.slotNumber;
  assert.equal((await captureFork(provider, 11155111)).fork, null);
  const shorter = { gasUsed: "100" }, longer = { gasUsed: "110" };
  const verified = { reason: "explained by protocol pricing", evidence: "Pinned creation probe" };
  assert.deepEqual(classifyDiscrepancy(longer, shorter, verified), verified);
  assert.equal(classifyDiscrepancy(longer, shorter, { reason: "state difference" }).reason, "unexplained");
  assert.equal(classifyDiscrepancy({ gasUsed: "105" }, shorter, verified), null);
});
test("a public plan rejects fixture observations even when their hashes and deployment scope match", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "paired-observation-"));
  t.after(() => fs.rmSync(directory, { recursive: true }));
  const step = { id: "premium.otp-authorize", method: "confirmManualPayment" };
  const deploymentManifestHash = "b".repeat(64);
  const data = { schema: "block-insure-paired-app-observation/v1", source: "isolated fixture adapter",
    operationId: step.id, method: step.method, chainId: 11155111, manifestHash, deploymentManifestHash,
    observedAt: "2026-11-24T01:00:00.000Z", status: "confirmed", outcome: { consent: true } };
  const text = JSON.stringify(data);
  fs.writeFileSync(path.join(directory, "observation.json"), text);
  const options = { witness: { file: "observation.json", evidenceSha256: digest(text) }, planDirectory: directory,
    step, chainId: 11155111, manifestHash, deploymentManifestHash };
  assert.equal(validateObservation({ ...options, local: true }), digest(text));
  assert.throws(() => validateObservation({ ...options, local: false }), /isolated live-service observation/);
});
test("receipt adoption covers bank, registry, worker, reviewer access, and evidence service sends", () => {
  const serviceSteps = scenario.manifest.operations.filter(isServiceTransaction).map(({ id }) => id);
  for (const id of ["premium.otp-settle", "premium.eft-settle", "manual.publish", "manual.commit-1", "manual.reveal-2", "manual.review-open"]) {
    assert.ok(serviceSteps.includes(id), id);
  }
  for (const id of ["premium.wallet", "manual.oracle-request", "manual.vote-1", "manual.withdraw"]) {
    assert.ok(!serviceSteps.includes(id), id);
  }
  assert.ok(isServiceTransaction({ target: "EvidenceRegistry", method: "anchorEvidenceTreeHead", category: "evidence" }));
});
test("operation fingerprints bind real arguments and verified pre-state across address substitutions", () => {
  const a = "0x" + "1".repeat(40), b = "0x" + "2".repeat(40);
  const input = (actor, previousBalance, order = "issue") => ({
    step: { ...step, target: "InsuranceManager", valueEth: "0.0005" },
    args: [3n, actor, 500000000000000n], previousOperation: order,
    before: { component: "PolicyEconomics", signature: "paid(uint256,address) view returns(uint256)",
      args: [3n, actor], equals: previousBalance },
    substitutions: new Map([[actor, "$role.holder"]]),
  });
  assert.equal(operationFingerprint(input(a, 0n)), operationFingerprint(input(b, 0n)));
  assert.notEqual(operationFingerprint(input(a, 0n)), operationFingerprint(input(b, 1n)));
  assert.notEqual(operationFingerprint(input(a, 0n)), operationFingerprint(input(b, 0n, "other")));
  const changed = input(b, 0n); changed.args[2] += 1n;
  assert.notEqual(operationFingerprint(input(a, 0n)), operationFingerprint(changed));
});

test("timing summarizes each method as a median, range and sample count", () => {
  assert.deepEqual(timing([{ a: 30 }, { a: null }, { a: 10 }, { a: 20 }, { a: 31 }], "a"),
    { n: 4, medianMs: 25, rangeMs: [10, 31] });
});
test("pricing reconstructs and validates a mined type-2 RPC envelope", async () => {
  const wallet = ethers.Wallet.createRandom();
  const raw = await wallet.signTransaction({ to: ethers.ZeroAddress, type: 2, chainId: 84532, nonce: 14, data: "0x010055",
    value: 30n, gasLimit: 44000n, maxFeePerGas: 16n, maxPriorityFeePerGas: 2n });
  const tx = ethers.Transaction.from(raw);
  const wire = { hash: tx.hash, from: wallet.address, type: "0x2", to: tx.to, chainId: ethers.toQuantity(tx.chainId),
    nonce: ethers.toQuantity(tx.nonce), value: ethers.toQuantity(tx.value), gas: ethers.toQuantity(tx.gasLimit),
    input: tx.data, gasPrice: "0xa", maxFeePerGas: ethers.toQuantity(tx.maxFeePerGas), maxPriorityFeePerGas: "0x2",
    r: tx.signature.r, s: tx.signature.s, v: ethers.toQuantity(tx.signature.yParity), accessList: [],
  };
  assert.equal(decodeEnvelope(wire)?.unsignedSerialized, tx.unsignedSerialized);
  assert.equal(decodeEnvelope({ ...wire, input: "0x02" }), null);
});

test("receipt export decodes payout only from the selected manager", () => {
  const manager = "0x" + "1".repeat(40), adjudicator = "0x" + "2".repeat(40), holder = "0x" + "3".repeat(40);
  const event = new ethers.Interface(["event SettlementWithdrawn(uint256 indexed claimId,address indexed claimant,uint256 amount,uint256 timestamp)"]);
  const log = event.encodeEventLog(event.getEvent("SettlementWithdrawn"), [1, holder, 400, 1]);
  const result = normalize({
    step, manifestHash, chainId: 84532, receipt: { gasUsed: "100", status: "1", logs: [{ address: manager, ...log }, { address: holder, ...log }] },
    tx: { value: "0", from: holder, to: manager, gasPrice: "20", input: "0x1234", hash: ethers.id("payout") },
    block: { number: "1", timestamp: "1", hash: ethers.id("block") },
    contracts: { InsuranceManager: manager, ClaimAdjudicator: adjudicator }, ledger: {},
  });
  assert.deepEqual(result.transfers, [{ kind: "payout", from: adjudicator, to: holder, valueWei: "400" }]);
  assert.equal(result.gasPriceSource, "transaction.gasPrice");
  assert.equal(result.calldataBytes, 2);
});
test("signed-intent resumption reconciles a mined transaction without another send", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "paired-ledger-"));
  t.after(() => { fs.unlinkSync(path.join(directory, "operations.jsonl")); fs.rmdirSync(directory); });
  const wallet = ethers.Wallet.createRandom();
  const target = "0x" + "1".repeat(40), blockHash = ethers.id("canonical block");
  const block = { number: "0x1", hash: blockHash };
  let broadcasts = 0, tx;
  const provider = {
    getTransactionCount: async () => 0, estimateGas: async () => 21000n,
    async send(method, params) {
      if (method === "eth_sendRawTransaction") {
        broadcasts += 1;
        const parsed = ethers.Transaction.from(params[0]);
        tx = { hash: parsed.hash, from: parsed.from, to: parsed.to, input: parsed.data, value: "0", blockHash };
        return tx.hash;
      }
      if (method === "eth_getTransactionReceipt") return tx && { transactionHash: tx.hash, status: "1", blockHash, blockNumber: "0x1" };
      if (method === "eth_getTransactionByHash") return tx;
      if (method === "eth_getBlockByNumber") return block;
      if (method === "eth_call") return ethers.AbiCoder.defaultAbiCoder().encode(["bool"], [true]);
      throw new Error("Unexpected RPC " + method);
    },
  };
  const item = { step: { ...step, method: "receive" }, from: wallet.address, target,
    tx: { data: "0x", value: 0n, to: target },
    detail: { gasLimit: "21000", assertion: { component: "Probe", signature: "ready() view returns(bool)", args: [], equals: true } } };
  const settings = { chainId: 31337, deployment: { components: { Probe: target } }, receiptTimeoutMs: 1000, pollMs: 1 };
  const identity = { manifestHash, type: "run" };
  const args = { provider, item, settings, signer: wallet, reviewedFees: { maxFeePerGasWei: "100", priorityWei: "1" } };
  const original = openJournal(directory, identity);
  try { await assert.rejects(executeIntent({ ...args, journal: original, interrupt: step.id }), /interrupted/); }
  finally { original.close(); }
  const resumed = openJournal(directory, identity);
  try {
    const result = await executeIntent({ ...args, journal: resumed });
    assert.equal(result.canonical.tx.hash, tx.hash);
    assert.equal(broadcasts, 1);
    assert.equal(resumed.entries.filter((entry) => entry.type === "receipt").length, 1);
  } finally { resumed.close(); }
});
test("readiness requires two distinct role-matched workers with fresh polls and lag at most 150", () => {
  const manager = "0x" + "1".repeat(40), coordinator = "0x" + "2".repeat(40);
  const oracles = ["0x" + "3".repeat(40), "0x" + "4".repeat(40)];
  const deployment = { chainId: "84532", components: { InsuranceManager: manager, OracleCoordinator: coordinator },
    modelIdentityHash: ethers.id("model"), oracleWallets: oracles };
  const now = Date.now(), stamp = new Date(now).toISOString();
  const api = { status: "ready", deployment: { managerAddress: manager }, services: {
    chainId: 84532, database: "connected", blockchainRpc: "connected",
  }, timestamp: stamp };
  const workers = oracles.map((address, index) => ({
    status: "ready", workerEnabled: true, deployment: { chainId: 84532, managerAddress: manager, coordinatorAddress: coordinator },
    protocolModel: { identity: deployment.modelIdentityHash }, operationalRelease: { runtimeIdentityHash: ethers.id("runtime") },
    oracleWallet: address, registrySnapshot: index ? "oracle2" : "primary", scanLagBlocks: 150,
    lastSuccessfulPollAt: stamp, headObservedAt: stamp,
  }));
  assert.equal(validateReadiness([api, ...workers], deployment, now), true);
  workers[1].scanLagBlocks = 151;
  assert.equal(validateReadiness([api, ...workers], deployment, now), false);
});

