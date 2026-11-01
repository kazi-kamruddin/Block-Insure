const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { configureOracleFixture, finalizeExactResult } = require("./helpers/oracleCoordinator");

describe("Policy cancellation refunds", function () {
  const premium = ethers.parseEther("0.01");
  async function fixture(funded = true) {
    const [admin, holder, outsider] = await ethers.getSigners();
    const insurance = await (await ethers.getContractFactory("InsuranceManager")).deploy();
    await insurance.createPolicyPackage("Medical", "HEALTH", premium, ethers.parseEther("1"), 365, "HOSPITAL_BILL");
    await insurance.connect(holder).purchasePolicy(1, { value: premium });
    const benefits = await (await ethers.getContractFactory("PolicyBenefitsManager")).deploy(await insurance.getAddress());
    const economics = await ethers.getContractAt("PolicyEconomics", await insurance.policyEconomics());
    await economics.configureBenefitsManager(await benefits.getAddress());
    await benefits.publishBenefitTerms(1, false, true, false, 0, 5000, 0, 2, 1, ethers.id("refund-v1"));
    if (funded) await admin.sendTransaction({ to: await benefits.getAddress(), value: ethers.parseEther("1") });
    return { insurance, benefits, economics, admin, holder, outsider };
  }
  async function paidTwice(f) {
    const policy = await f.insurance.getPolicy(1);
    await time.increaseTo(policy.startDate + 60n * 86400n);
    await f.insurance.connect(f.holder).payPremium(1, 2, { value: premium });
  }
  async function request(f) {
    await paidTwice(f); await f.insurance.connect(f.holder).cancelPolicy(1);
    await f.benefits.connect(f.holder).requestBenefit(1, 1, ethers.ZeroHash);
  }
  it("rejects death/maturity product publication and unreachable or excessive refund terms", async function () {
    const f = await fixture();
    const publish = (...args) => f.benefits.publishBenefitTerms(1, ...args, 2, ethers.id("v2"));
    await expect(publish(true, true, false, 10000, 5000, 0, 2)).to.be.reverted;
    await expect(publish(false, true, true, 0, 5000, 500, 2)).to.be.reverted;
    await expect(publish(false, true, false, 0, 5000, 0, 6)).to.be.reverted;
    await expect(publish(false, true, false, 0, 5001, 0, 2)).to.be.reverted;
    await f.insurance.createPolicyPackage("Short", "HEALTH", premium, premium, 30, "HOSPITAL_BILL");
    await expect(f.benefits.publishBenefitTerms(2, false, true, false, 0, 5000, 0, 2, 1, ethers.id("short"))).to.be.reverted;
  });
  it("requires actual scheduled receipts, ownership and cancellation", async function () {
    const f = await fixture();
    await expect(f.benefits.connect(f.outsider).requestBenefit(1, 1, ethers.ZeroHash)).to.be.reverted;
    await expect(f.benefits.connect(f.holder).requestBenefit(1, 1, ethers.ZeroHash)).to.be.reverted;
    await expect(f.insurance.connect(f.holder).payPremium(1, 2, { value: premium })).to.be.reverted;
    await paidTwice(f);
    await expect(f.benefits.connect(f.holder).requestBenefit(1, 1, ethers.ZeroHash)).to.be.reverted;
    await f.insurance.connect(f.holder).cancelPolicy(1);
    await f.benefits.connect(f.holder).requestBenefit(1, 1, ethers.ZeroHash);
    expect((await f.benefits.getBenefitRequest(1)).amount).to.equal(premium);
    await expect(f.benefits.connect(f.holder).requestBenefit(1, 1, ethers.ZeroHash)).to.be.reverted;
  });
  it("keeps disabled products unavailable even when their other conditions would hold", async function () {
    const f = await fixture();
    await expect(f.benefits.connect(f.holder).requestBenefit(1, 0, ethers.id("unverified-death"))).to.be.reverted;
    await time.increaseTo((await f.insurance.getPolicy(1)).endDate + 1n);
    await expect(f.benefits.connect(f.holder).requestBenefit(1, 2, ethers.ZeroHash)).to.be.reverted;
  });
  it("reserves only backed refunds and later recovers after funding", async function () {
    const f = await fixture(false); await request(f);
    await expect(f.benefits.approveBenefit(1)).to.be.reverted;
    expect(await f.benefits.totalReservedLiabilityWei()).to.equal(0);
    await f.admin.sendTransaction({ to: await f.benefits.getAddress(), value: premium });
    await f.benefits.approveBenefit(1);
    expect(await f.benefits.totalReservedLiabilityWei()).to.equal(premium);
    await expect(f.benefits.withdrawExcess(f.admin.address, 1)).to.be.reverted;
  });
  it("allocates a pull refund once, closes future cover and preserves paid-incident reporting", async function () {
    const f = await fixture(); await request(f); await f.benefits.approveBenefit(1); await f.benefits.settleBenefit(1);
    expect(await f.benefits.claimableBenefitWei(f.holder.address)).to.equal(premium);
    await expect(f.benefits.connect(f.outsider).withdrawBenefit()).to.be.reverted;
    const before = await ethers.provider.getBalance(await f.benefits.getAddress());
    await f.benefits.connect(f.holder).withdrawBenefit();
    expect(await ethers.provider.getBalance(await f.benefits.getAddress())).to.equal(before - premium);
    expect(await f.benefits.claimableBenefitWei(f.holder.address)).to.equal(0);
    await expect(f.benefits.connect(f.holder).withdrawBenefit()).to.be.reverted;
    await expect(f.benefits.settleBenefit(1)).to.be.reverted;
    const policy = await f.insurance.getPolicy(1);
    const now = BigInt(await time.latest());
    await expect(f.insurance.connect(f.holder).submitClaim(1, premium, now, "HOSPITALIZATION", "HOSP-001", ethers.id("post-refund"), ethers.id("doc"), "ipfs://doc")).to.be.reverted;
    await f.insurance.connect(f.holder).submitClaim(1, premium, policy.startDate, "HOSPITALIZATION", "HOSP-001", ethers.id("covered-before-cancellation"), ethers.id("historical-doc"), "ipfs://historical-doc");
    expect((await f.economics.getClaimReservation(1)).reserved).to.equal(true);
  });
  it("preserves correction and appeal rights for a covered medical incident after a refund", async function () {
    const f = await fixture(); await request(f); await f.benefits.approveBenefit(1); await f.benefits.settleBenefit(1);
    const [, , , oracle1, oracle2, ...auditors] = await ethers.getSigners();
    const adjudicator = await (await ethers.getContractFactory("ClaimAdjudicator")).deploy(await f.insurance.getAddress());
    await f.insurance.configureClaimAdjudicator(await adjudicator.getAddress());
    const coordinator = await configureOracleFixture(f.insurance, f.admin, [oracle1, oracle2], { threshold: 2, commitBlocks: 8, revealBlocks: 8 });
    for (const auditor of auditors.slice(0, 4)) await f.insurance.grantProjectRole(await f.insurance.AUDITOR_ROLE(), auditor.address);
    const policy = await f.insurance.getPolicy(1);
    await f.insurance.connect(f.holder).submitClaim(1, premium, policy.startDate, "HOSPITALIZATION", "HOSP-001", ethers.id("runoff-invoice"), ethers.id("runoff-document"), "ipfs://runoff");
    const initialLiability = ethers.parseEther("0.0072");
    const amendedLiability = ethers.parseEther("0.0144");
    expect(await f.economics.activeExposureWei()).to.equal(initialLiability);
    await f.insurance.requestOracleVerification(1);
    const oracleRequest = await coordinator.getRequestByClaimId(1);
    await finalizeExactResult(coordinator, oracleRequest.requestId, [oracle1, oracle2], false, ethers.id("runoff-negative"));
    await f.insurance.sendToManualReview(1);
    await time.increaseTo((await adjudicator.getPreparation(1, 1)).deadline + 1n);
    await adjudicator.expirePreparation(1, 1);
    expect(await f.economics.activeExposureWei()).to.equal(0);
    await f.insurance.connect(f.holder).amendRejectedClaim(1, premium * 2n, ethers.id("corrected-runoff-invoice"));
    await f.insurance.connect(f.holder).submitAppeal(1, "corrected covered-incident appeal after refund");
    expect(await f.insurance.claimVersion(1)).to.equal(2);
    expect((await f.economics.getClaimReservation(1)).reserved).to.equal(true);
    expect(await f.economics.coverageTerminated(1)).to.equal(true);
    expect(await f.economics.activeExposureWei()).to.equal(amendedLiability);
    await f.insurance.requestOracleVerification(1);
    const appealRequest = await coordinator.getRequestByClaimId(1);
    await finalizeExactResult(coordinator, appealRequest.requestId, [oracle1, oracle2], true, ethers.id("runoff-approved"));
    await f.insurance.connect(f.holder).withdrawSettlement(1);
    expect(await f.economics.activeExposureWei()).to.equal(0);
    expect((await f.economics.getClaimReservation(1)).settled).to.equal(true);
    expect((await f.economics.getCoverageAccount(1)).settledCoverageWei).to.equal(amendedLiability);
  });
  it("rejection releases liability and permits one replacement request without changing accepted terms", async function () {
    const f = await fixture(); await request(f); await f.benefits.approveBenefit(1);
    await f.benefits.rejectBenefit(1, ethers.id("incomplete-request"));
    expect(await f.benefits.totalReservedLiabilityWei()).to.equal(0);
    await f.benefits.publishBenefitTerms(1, false, true, false, 0, 2500, 0, 2, 2, ethers.id("new-refund"));
    await f.benefits.connect(f.holder).requestBenefit(1, 1, ethers.ZeroHash);
    expect((await f.benefits.getBenefitRequest(2)).amount).to.equal(premium);
    expect((await f.benefits.getBenefitRequest(2)).termsVersion).to.equal(1);
  });
  it("preserves manager-admin authority and restricts request decisions", async function () {
    const f = await fixture(); await request(f);
    await expect(f.benefits.connect(f.outsider).approveBenefit(1)).to.be.reverted;
    await expect(f.benefits.connect(f.outsider).rejectBenefit(1, ethers.id("reason"))).to.be.reverted;
    await expect(f.benefits.connect(f.outsider).settleBenefit(1)).to.be.reverted;
  });
  it("blocks terminal refund allocation while a medical claim remains reserved", async function () {
    const f = await fixture(); await paidTwice(f);
    const policy = await f.insurance.getPolicy(1);
    await f.insurance.connect(f.holder).submitClaim(1, premium, policy.startDate, "HOSPITALIZATION", "HOSP-001", ethers.id("pending"), ethers.id("pending-doc"), "ipfs://pending");
    await f.insurance.connect(f.holder).cancelPolicy(1);
    await f.benefits.connect(f.holder).requestBenefit(1, 1, ethers.ZeroHash);
    await f.benefits.approveBenefit(1);
    expect((await f.economics.getClaimReservation(1)).reserved).to.equal(true);
    const reserved = await f.benefits.totalReservedLiabilityWei();
    await expect(f.benefits.settleBenefit(1)).to.be.reverted;
    expect(await f.benefits.totalReservedLiabilityWei()).to.equal(reserved);
    expect(await f.benefits.terminalBenefitSettled(1)).to.equal(false);
  });
});
