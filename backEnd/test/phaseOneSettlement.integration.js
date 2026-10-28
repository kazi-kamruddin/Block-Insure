// Run only through the isolated Phase 1 stack, after the browser workflows.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");
const { ethers } = require("ethers");
const Account = require("../models/BankAccount");
const Transaction = require("../models/BankTransaction");
const Mandate = require("../models/EftMandate");
const { createSettlement, reconcileOperation } = require("../services/bankSettlementService");
const { getDeploymentScope } = require("../services/deploymentScopeService");
const contracts = require("../services/contractService");
const payments = require("../services/bankPaymentService");
const load = require("./helpers/loadIsolatedModule");
const day = 86400n;
let provider, holder, gateway, manager, economics;

test.before(async () => {
  const uri = new URL(process.env.MONGODB_URI || "");
  assert.ok(["localhost", "127.0.0.1"].includes(uri.hostname) && /^\/block_insure_[a-z0-9_]*e2e$/.test(uri.pathname), "Disposable loopback E2E database required");
  provider = new ethers.JsonRpcProvider(process.env.RPC_URL, 31337, { staticNetwork: true, cacheTimeout: -1 });
  assert.equal((await provider.getNetwork()).chainId, 31337n);
  holder = new ethers.Wallet(process.env.E2E_USER_PRIVATE_KEY, provider);
  gateway = new ethers.Wallet(process.env.BANK_PRIVATE_KEY, provider);
  manager = new ethers.Contract(process.env.CONTRACT_ADDRESS, require("../abi/InsuranceManager.json").abi, holder);
  economics = await contracts.getPolicyEconomics(manager);
  await mongoose.connect(process.env.MONGODB_URI);
  await Promise.all([Account.init(), Transaction.init(), Mandate.init()]);
});
test.after(async () => { await mongoose.disconnect(); provider?.destroy(); });

async function fixture(balanceMinor = 5000000) {
  const offer = await economics.getPackageIssueHash(1);
  await (await manager.purchasePolicyWithTerms(1, offer, ethers.id("isolated-settlement-test-document"), { value: ethers.parseEther("0.01") })).wait();
  const policyId = String(await manager.policyCounter() - 1n);
  const policy = await manager.getPolicy(policyId);
  await provider.send("evm_setNextBlockTimestamp", [Number(policy.startDate + 60n * day)]);
  await provider.send("evm_mine", []);
  const q = await economics.getInstallmentQuote(policyId, policy.nextPremiumDueDate);
  const account = await Account.create({ bankId: "BANK-001", accountReference: `PHASE1-${crypto.randomUUID()}`,
    ownerWalletAddress: holder.address.toLowerCase(), accountHolderName: "Synthetic settlement test", lastFour: "0001", balanceMinor });
  return { account, policy, policyId, installmentId: String(q.installmentId), amountWei: String(q.amountWei),
    amountMinor: payments.premiumWeiToMinor(q.amountWei), dueAt: new Date(Number(q.dueAt) * 1000), type: "MANUAL_OTP" };
}
const balance = async (details) => (await Account.findById(details.account.id)).balanceMinor;
const awaitTerminal = async (operation, service = { reconcileOperation }) => {
  for (let attempt = 0; attempt < 20 && operation.status === "PROCESSING"; attempt++) {
    operation = await service.reconcileOperation(operation, { signer: gateway });
    if (operation.status === "PROCESSING") await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return operation;
};
const faultService = ({ hideReceipts = false, beforeBroadcast } = {}) => {
  const faultyProvider = new Proxy(provider, { get(target, key) {
    if (key === "getTransactionReceipt" && hideReceipts) return async () => null;
    if (key === "broadcastTransaction") return async (raw) => {
      if (beforeBroadcast) await beforeBroadcast(raw);
      const response = await target.broadcastTransaction(raw);
      if (hideReceipts) throw new Error("Synthetic lost RPC acknowledgement after broadcast");
      return response;
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  return load("services/bankSettlementService.js", { "./contractService": { ...contracts, getProvider: () => faultyProvider } }, process.env);
};

test("a lost broadcast acknowledgement stays reserved and a fresh service reconciles the same signed transaction", async () => {
  const details = await fixture();
  const initialBalance = await balance(details);
  const service = faultService({ hideReceipts: true });
  const operation = await service.createSettlement(details, gateway);
  assert.equal(operation.status, "PROCESSING");
  assert.match(operation.transactionHash, /^0x[0-9a-f]{64}$/);
  assert.equal(await balance(details), initialBalance - details.amountMinor);
  const again = await service.createSettlement(details, gateway);
  assert.equal(again.transactionId, operation.transactionId);
  assert.equal(await balance(details), initialBalance - details.amountMinor);
  // A separate process has no original queue, lease or in-memory transaction.
  // It can finish solely from the durable reservation and signed bytes.
  const recovered = spawnSync(process.execPath, ["-e", `
    const mongoose = require("mongoose");
    const Transaction = require("./models/BankTransaction");
    const { reconcileOperation } = require("./services/bankSettlementService");
    (async () => {
      await mongoose.connect(process.env.MONGODB_URI);
      let operation = await Transaction.findOne({ transactionId: process.argv[1] });
      for (let attempt = 0; attempt < 20 && operation.status === "PROCESSING"; attempt++) {
        operation = await reconcileOperation(operation);
        if (operation.status === "PROCESSING") await new Promise((resolve) => setTimeout(resolve, 200));
      }
      console.log(JSON.stringify({ status: operation.status, transactionHash: operation.transactionHash }));
      await mongoose.disconnect(); process.exit(0);
    })().catch(() => process.exit(1));
  `, operation.transactionId], { cwd: path.resolve(__dirname, ".."), env: process.env, encoding: "utf8", windowsHide: true, timeout: 15000 });
  assert.equal(recovered.status, 0, "A fresh process reconciles the durable operation");
  const settled = JSON.parse(recovered.stdout.trim());
  assert.equal(settled.status, "PAID");
  assert.equal(settled.transactionHash, operation.transactionHash);
  assert.equal(await balance(details), initialBalance - details.amountMinor);
  assert.equal((await manager.getPolicy(details.policyId)).installmentsPaid, 2n);
  assert.equal((await reconcileOperation(await Transaction.findById(operation._id), { signer: gateway })).status, "PAID");
  assert.equal(await balance(details), initialBalance - details.amountMinor);
});

test("concurrent operations for one installment reserve and credit at most once", async () => {
  const details = await fixture();
  const initialBalance = await balance(details);
  const operations = await Promise.all([createSettlement(details, gateway), createSettlement(details, gateway)]);
  assert.equal(operations[0].transactionId, operations[1].transactionId);
  assert.equal((await awaitTerminal(operations[0])).status, "PAID");
  assert.equal(await balance(details), initialBalance - details.amountMinor);
  assert.equal((await manager.getPolicy(details.policyId)).installmentsPaid, 2n);
});

test("a wallet winning after gateway signing makes the gateway revert and refund exactly once", async () => {
  const details = await fixture();
  const initialBalance = await balance(details);
  let walletPaid = false;
  const service = faultService({ beforeBroadcast: async () => {
    if (walletPaid) return;
    walletPaid = true;
    await (await manager.payPremium(details.policyId, details.installmentId, { value: BigInt(details.amountWei) })).wait();
  } });
  const operation = await service.createSettlement(details, gateway);
  const final = await awaitTerminal(operation);
  assert.equal(final.status, "FAILED");
  assert.equal(await balance(details), initialBalance);
  assert.equal((await manager.getPolicy(details.policyId)).installmentsPaid, 2n);
  await reconcileOperation(final, { signer: gateway });
  assert.equal(await balance(details), initialBalance);
});

test("insufficient simulated balance never broadcasts or credits the installment", async () => {
  const details = await fixture(1);
  const operation = await createSettlement(details, gateway);
  assert.equal(operation.status, "FAILED");
  assert.equal(operation.transactionHash, "");
  assert.equal(await balance(details), 1);
  assert.equal((await manager.getPolicy(details.policyId)).installmentsPaid, 1n);
});

test("an unfunded authorized gateway restores the reservation without creating an unbacked credit", async () => {
  const details = await fixture();
  const empty = ethers.Wallet.createRandom().connect(provider);
  const admin = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);
  const registry = contracts.getBankIdentityRegistry(admin);
  await (await registry.grantRole(await registry.BANK_ROLE(), empty.address)).wait();
  const operation = await createSettlement(details, empty);
  assert.equal(operation.status, "FAILED");
  assert.equal(operation.transactionHash, "");
  assert.equal(await balance(details), details.account.balanceMinor);
  assert.equal((await manager.getPolicy(details.policyId)).installmentsPaid, 1n);
});

test("a valid manual OTP is consumed once under concurrent confirmation and settles test ETH", async () => {
  const details = await fixture();
  const otp = await payments.requestManualPaymentOtp({ walletAddress: holder.address,
    accountReference: details.account.accountReference, policyId: details.policyId });
  const input = { walletAddress: holder.address, challengeId: otp.challengeId, otp: otp.demoOtp };
  const results = await Promise.allSettled([payments.confirmManualPaymentOtp(input), payments.confirmManualPaymentOtp(input)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const operation = await awaitTerminal(results.find((result) => result.status === "fulfilled").value);
  assert.equal(operation.status, "PAID");
  assert.equal(await balance(details), details.account.balanceMinor - details.amountMinor);
  assert.equal((await manager.getPolicy(details.policyId)).installmentsPaid, 2n);
  await assert.rejects(payments.confirmManualPaymentOtp(input));
});

test("a stale OTP cannot authorize the following period after a wallet payment", async () => {
  const details = await fixture();
  const otp = await payments.requestManualPaymentOtp({ walletAddress: holder.address,
    accountReference: details.account.accountReference, policyId: details.policyId });
  assert.equal(otp.installmentId, details.installmentId);
  await (await manager.payPremium(details.policyId, details.installmentId, { value: BigInt(details.amountWei) })).wait();
  await assert.rejects(payments.confirmManualPaymentOtp({ walletAddress: holder.address, challengeId: otp.challengeId, otp: otp.demoOtp }),
    (error) => error.statusCode === 409);
  assert.equal(await balance(details), details.account.balanceMinor);
  assert.equal(await Transaction.countDocuments({ accountReference: details.account.accountReference }), 0);
});

test("automatic collection follows the shared due date, skips a wallet-paid period and respects cancellation", async () => {
  const details = await fixture();
  const latest = await provider.getBlock("latest");
  const mandate = await payments.createMandate({ walletAddress: holder.address, accountReference: details.account.accountReference,
    policyId: details.policyId, validFrom: new Date(Number(latest.timestamp) * 1000), validUntil: new Date(Number(details.policy.endDate) * 1000) });
  await payments.approveMandate({ bankId: "BANK-001", bankWallet: gateway.address, mandateId: mandate.mandateId });
  await (await manager.payPremium(details.policyId, details.installmentId, { value: BigInt(details.amountWei) })).wait();
  await provider.send("evm_setNextBlockTimestamp", [Number(details.policy.startDate + 90n * day)]);
  await provider.send("evm_mine", []);
  await payments.runBankAutomation({ referenceDate: new Date(Number((await provider.getBlock("latest")).timestamp) * 1000) });
  assert.equal(await Transaction.countDocuments({ mandateId: mandate.mandateId }), 0);
  assert.equal((await Mandate.findById(mandate.id)).nextDebitAt.getTime(), Number(details.policy.startDate + 180n * day) * 1000);
  await payments.cancelMandate({ walletAddress: holder.address, mandateId: mandate.mandateId });
  await provider.send("evm_setNextBlockTimestamp", [Number(details.policy.startDate + 180n * day)]);
  await provider.send("evm_mine", []);
  await payments.runBankAutomation({ referenceDate: new Date(Number((await provider.getBlock("latest")).timestamp) * 1000) });
  assert.equal(await Transaction.countDocuments({ mandateId: mandate.mandateId }), 0);
});

test("EFT and manual OTP alternate on one timeline, including the short final period", async () => {
  const details = await fixture();
  const mandate = await payments.createMandate({ walletAddress: holder.address, accountReference: details.account.accountReference,
    policyId: details.policyId, validFrom: new Date(Number(details.policy.startDate) * 1000), validUntil: new Date(Number(details.policy.endDate) * 1000) });
  await payments.approveMandate({ bankId: "BANK-001", bankWallet: gateway.address, mandateId: mandate.mandateId });
  const collect = async (days, expectedId) => {
    await provider.send("evm_setNextBlockTimestamp", [Number(details.policy.startDate + BigInt(days) * day)]);
    await provider.send("evm_mine", []);
    await payments.runBankAutomation({ referenceDate: new Date(Number((await provider.getBlock("latest")).timestamp) * 1000) });
    const operation = await Transaction.findOne({ mandateId: mandate.mandateId, installmentId: String(expectedId) });
    assert.ok(operation, "Automatic collection created the due installment operation");
    assert.equal((await awaitTerminal(operation)).status, "PAID");
  };
  await collect(90, 2);
  await provider.send("evm_setNextBlockTimestamp", [Number(details.policy.startDate + 150n * day)]);
  await provider.send("evm_mine", []);
  const otp = await payments.requestManualPaymentOtp({ walletAddress: holder.address, accountReference: details.account.accountReference, policyId: details.policyId });
  assert.equal(otp.installmentId, "3");
  const manual = await payments.confirmManualPaymentOtp({ walletAddress: holder.address, challengeId: otp.challengeId, otp: otp.demoOtp });
  assert.equal((await awaitTerminal(manual)).status, "PAID");
  await provider.send("evm_setNextBlockTimestamp", [Number(details.policy.startDate + 180n * day)]);
  await provider.send("evm_mine", []);
  await payments.runBankAutomation({ referenceDate: new Date(Number((await provider.getBlock("latest")).timestamp) * 1000) });
  assert.equal(await Transaction.countDocuments({ mandateId: mandate.mandateId }), 1);
  await collect(270, 4);
  await collect(360, 5);
  const final = await Transaction.findOne({ mandateId: mandate.mandateId, installmentId: "5" });
  assert.equal(final.amountWei, ((ethers.parseEther("0.01") * 5n + 89n) / 90n).toString());
  assert.equal((await manager.getPolicy(details.policyId)).installmentsPaid, 5n);
  await reconcileOperation(final, { signer: gateway });
  assert.equal((await Mandate.findById(mandate.id)).debitCount, 3);
  assert.equal((await Mandate.findById(mandate.id)).settledTransferReferences.length, 3);
});
