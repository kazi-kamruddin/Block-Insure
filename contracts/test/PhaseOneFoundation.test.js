const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Completion phase one: installments, gateway and issued terms", function () {
  const day = 86400n;
  const premium = ethers.parseEther("0.01");
  async function fixture() {
    const [admin, holder, gateway] = await ethers.getSigners();
    const manager = await (await ethers.getContractFactory("InsuranceManager")).deploy();
    const economics = await ethers.getContractAt("PolicyEconomics", await manager.policyEconomics());
    const registry = await (await ethers.getContractFactory("BankIdentityRegistry")).deploy(await manager.getAddress(), admin.address);
    await registry.registerBankIdentity("SIMULATED_GATEWAY", gateway.address);
    await manager.configureBankPaymentRegistry(await registry.getAddress());
    await manager.createPolicyPackage("Custom coverage", "HEALTH", premium, ethers.parseEther("1"), 365, "PRIMARY_INVOICE");
    const rules = { version: 1, waitingPeriod: 2 * 86400, reinstatementWaitingPeriod: 86400,
      claimDeadline: 180 * 86400, minimumDocumentCommitments: 1, deductibleRateBps: 750,
      insurerShareBps: 6500, deductibleCapWei: ethers.parseEther("0.015"), maximumClaimWei: ethers.parseEther("0.8"),
      exclusionsRoot: ethers.id("exclusions"), requiredDocumentsRoot: ethers.id("invoice"),
      settlementFormulaVersion: ethers.id("BLOCK_INSURE_SETTLEMENT_V1"), policyRuleVersion: ethers.id("custom-rules") };
    await economics.publishPackageRules(1, rules, [ethers.id("SURGERY")], [ethers.id("COSMETIC")]);
    const offer = await economics.getPackageIssueHash(1);
    const documentHash = ethers.id("reviewed custom document");
    await manager.connect(holder).purchasePolicyWithTerms(1, offer, documentHash, { value: premium });
    const policy = await manager.getPolicy(1);
    const quote = async () => economics.getInstallmentQuote(1, (await manager.getPolicy(1)).nextPremiumDueDate);
    return { manager, economics, registry, admin, holder, gateway, policy, quote, rules, documentHash, offer };
  }

  it("rejects premature payments, preserves fixed dates and rejects a stale installment", async function () {
    const f = await fixture();
    await expect(f.manager.connect(f.holder).payPremium(1, 2, { value: premium })).to.be.reverted;
    await time.increaseTo(f.policy.startDate + 60n * day);
    await f.manager.connect(f.holder).payPremium(1, 2, { value: premium });
    expect((await f.manager.getPolicy(1)).nextPremiumDueDate).to.equal(f.policy.startDate + 180n * day);
    await expect(f.manager.connect(f.holder).payPremium(1, 2, { value: premium })).to.be.reverted;
    await expect(f.manager.connect(f.holder).payPremium(1, 3, { value: premium })).to.be.reverted;
  });

  it("moves exactly the quoted test ETH or reverts both transfer and credit", async function () {
    const f = await fixture();
    await time.increaseTo(f.policy.startDate + 60n * day);
    const before = await ethers.provider.getBalance(await f.manager.getAddress());
    const send = (value, ref) => f.registry.connect(f.gateway).confirmEftTransfer(1, f.holder.address, 2, ethers.id(ref), ethers.id("mandate"), { value });
    await expect(send(0, "unbacked")).to.be.reverted;
    await expect(send(premium / 2n, "underfunded")).to.be.reverted;
    await send(premium, "settled");
    expect(await ethers.provider.getBalance(await f.manager.getAddress())).to.equal(before + premium);
    expect((await f.manager.getPolicy(1)).installmentsPaid).to.equal(2);
    await expect(send(premium, "stale-race")).to.be.reverted;
    expect(await ethers.provider.getBalance(await f.registry.getAddress())).to.equal(0);
    expect(await f.registry.processedTransferReferences(ethers.id("stale-race"))).to.equal(false);
    await expect(f.manager.connect(f.holder).payPremium(1, 2, { value: premium })).to.be.reverted;
  });

  it("prorates the last five days and stops collection once all periods are paid", async function () {
    const f = await fixture();
    for (const id of [2n, 3n, 4n, 5n]) {
      const q = await f.quote();
      await time.increaseTo(q.opensAt);
      expect(q.installmentId).to.equal(id);
      if (id === 5n) expect(q.amountWei).to.equal((premium * 5n + 89n) / 90n);
      await f.manager.connect(f.holder).payPremium(1, id, { value: q.amountWei });
    }
    expect((await f.manager.getPolicy(1)).nextPremiumDueDate).to.equal(f.policy.endDate);
    expect((await f.quote()).installmentId).to.equal(0);
    await expect(f.manager.connect(f.holder).payPremium(1, 6, { value: premium })).to.be.reverted;
  });

  it("reinstates the current calendar period without charging or covering missed periods", async function () {
    const f = await fixture();
    await time.increaseTo(f.policy.startDate + 280n * day);
    const q = await f.quote();
    expect(q.installmentId).to.equal(4);
    expect(q.reinstatement).to.equal(true);
    await expect(f.manager.connect(f.holder).reinstatePolicy(1, 2, { value: premium })).to.be.reverted;
    await f.manager.connect(f.holder).reinstatePolicy(1, 4, { value: premium });
    const intervals = await f.economics.getCoverageIntervals(1);
    expect(intervals[1].startsAt).to.be.greaterThan(intervals[0].endsAt);
    expect(intervals[1].endsAt).to.equal(f.policy.startDate + 360n * day);
    expect((await f.manager.getPolicy(1)).installmentsPaid).to.equal(2);
  });

  it("pins custom issued rules and the reviewed document, and rejects a changed offer", async function () {
    const f = await fixture();
    expect(await f.economics.issuedDocumentHash(1)).to.equal(f.documentHash);
    expect((await f.economics.getPolicyTerms(1)).deductibleRateBps).to.equal(750);
    await f.economics.publishPackageRules(1, { ...f.rules, version: 2, insurerShareBps: 9000 }, [ethers.id("CONSULTATION")], []);
    await expect(f.manager.connect(f.holder).purchasePolicyWithTerms(1, f.offer, f.documentHash, { value: premium })).to.be.reverted;
    expect((await f.economics.getPolicyTerms(1)).insurerShareBps).to.equal(6500);
    await expect(f.economics.publishPackageRules(1, { ...f.rules, version: 3, minimumDocumentCommitments: 2 }, [], [])).to.be.reverted;
  });
});
