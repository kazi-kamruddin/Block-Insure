const { expect } = require("chai");
const { ethers, artifacts } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Immutable quarterly and accelerated testnet payment profiles", function () {
  async function fixture(name) {
    const [admin, holder, gateway] = await ethers.getSigners();
    const manager = await (await ethers.getContractFactory(name)).deploy();
    const economics = await ethers.getContractAt("PolicyEconomics", await manager.policyEconomics());
    const premium = ethers.parseEther("0.01");
    await manager.createPolicyPackage("Explicit test profile", "HEALTH", premium, ethers.parseEther("1"), 365, "HOSPITAL_BILL");
    const registry = await (await ethers.getContractFactory("BankIdentityRegistry")).deploy(await manager.getAddress(), admin.address);
    await registry.registerBankIdentity("SIMULATED_GATEWAY", gateway.address);
    await manager.configureBankPaymentRegistry(await registry.getAddress());
    await manager.connect(holder).purchasePolicy(1, { value: premium });
    return { manager, economics, premium, registry, holder, gateway, policy: await manager.getPolicy(1) };
  }

  for (const [name, profile, interval, advance, grace] of [
    ["InsuranceManager", "QUARTERLY", 90 * 86400, 30 * 86400, 7 * 86400],
    ["AcceleratedInsuranceManager", "ACCELERATED_TESTNET", 600, 480, 120],
  ]) it(`${profile} binds purchase, quote, fixed periods and cross-method replay protection`, async function () {
    const f = await fixture(name);
    const schedule = await f.economics.getPaymentSchedule();
    expect([...schedule]).to.deep.equal([ethers.id(profile), BigInt(interval), BigInt(advance), BigInt(grace)]);
    expect(f.policy.premiumInterval).to.equal(interval);
    expect(f.policy.nextPremiumDueDate).to.equal(f.policy.startDate + BigInt(interval));
    expect(f.policy.gracePeriodEnd).to.equal(f.policy.nextPremiumDueDate + BigInt(grace));
    const q = await f.economics.getInstallmentQuote(1, f.policy.nextPremiumDueDate);
    expect(q.opensAt).to.equal(f.policy.startDate + BigInt(interval - advance));
    await expect(f.manager.connect(f.holder).payPremium(1, 2, { value: f.premium })).to.be.reverted;
    await time.increaseTo(q.opensAt);
    await f.manager.connect(f.holder).payPremium(1, 2, { value: f.premium });
    await expect(f.registry.connect(f.gateway).confirmEftTransfer(1, f.holder.address, 2, ethers.id(profile), ethers.id("mandate"), { value: f.premium })).to.be.reverted;
    expect((await f.manager.getPolicy(1)).nextPremiumDueDate).to.equal(f.policy.startDate + 2n * BigInt(interval));
    const next = await f.economics.getInstallmentQuote(1, f.policy.startDate + 2n * BigInt(interval));
    expect(next.payableNow).to.equal(false);
    await time.increaseTo(next.dueAt);
    await f.registry.connect(f.gateway).confirmEftTransfer(1, f.holder.address, 3, ethers.id(`third-${profile}`), ethers.id("mandate"), { value: f.premium });
    expect((await f.manager.getPolicy(1)).installmentsPaid).to.equal(3);
    expect((await f.manager.getPolicy(1)).nextPremiumDueDate).to.equal(f.policy.startDate + 3n * BigInt(interval));
  });

  it("accelerated lapse/reinstatement excludes missed cover and does not change quarterly deployments", async function () {
    const accelerated = await fixture("AcceleratedInsuranceManager");
    const quarterly = await fixture("InsuranceManager");
    await time.increaseTo(accelerated.policy.startDate + 1800n);
    const quote = await accelerated.economics.getInstallmentQuote(1, accelerated.policy.nextPremiumDueDate);
    expect(quote.reinstatement).to.equal(true);
    expect(quote.installmentId).to.equal(4);
    expect(Number(await accelerated.manager.getEffectivePolicyStatus(1))).to.equal(3);
    await accelerated.manager.connect(accelerated.holder).reinstatePolicy(1, 4, { value: accelerated.premium });
    const intervals = await accelerated.economics.getCoverageIntervals(1);
    expect(intervals).to.have.length(2);
    expect(intervals[1].startsAt).to.be.greaterThan(intervals[0].endsAt);
    expect((await quarterly.manager.getPolicy(1)).premiumInterval).to.equal(90 * 86400);
  });

  it("both profiles retain runtime and initcode limits without raising the maintenance budget", async function () {
    for (const name of ["InsuranceManager", "AcceleratedInsuranceManager"]) {
      const artifact = await artifacts.readArtifact(name);
      expect((artifact.deployedBytecode.length - 2) / 2).to.be.at.most(24448);
      expect((artifact.bytecode.length - 2) / 2).to.be.at.most(49152);
    }
  });
});
