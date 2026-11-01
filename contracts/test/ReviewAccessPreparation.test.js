const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { configureOracleFixture, finalizeExactResult } = require("./helpers/oracleCoordinator");

describe("Review evidence-access preparation", function () {
  async function fixture() {
    const [admin, holder, oracle1, oracle2, a, b, c, d, outsider] = await ethers.getSigners();
    const manager = await (await ethers.getContractFactory("InsuranceManager")).deploy();
    const adjudicator = await (await ethers.getContractFactory("ClaimAdjudicator")).deploy(await manager.getAddress());
    await manager.configureClaimAdjudicator(await adjudicator.getAddress());
    const coordinator = await configureOracleFixture(manager, admin, [oracle1, oracle2], { threshold: 2, commitBlocks: 8, revealBlocks: 8 });
    for (const auditor of [a, b, c, d]) await manager.grantProjectRole(await manager.AUDITOR_ROLE(), auditor.address);
    const premium = ethers.parseEther("0.01");
    await manager.createPolicyPackage("Medical", "HEALTH", premium, ethers.parseEther("1"), 365, "HOSPITAL_BILL");
    await manager.connect(holder).purchasePolicy(1, { value: premium });
    await manager.fundContract({ value: ethers.parseEther("1") });
    const policy = await manager.getPolicy(1);
    await manager.connect(holder).submitClaim(1, ethers.parseEther("0.1"), policy.startDate, "HOSPITALIZATION", "HOSP-001", ethers.id("invoice"), ethers.id("document"), "ipfs://document");
    async function failOracle() {
      await manager.requestOracleVerification(1);
      const request = await coordinator.getRequestByClaimId(1);
      await finalizeExactResult(coordinator, request.requestId, [oracle1, oracle2], false, ethers.id(`failed:${request.claimVersion}`));
    }
    await failOracle(); await manager.sendToManualReview(1);
    return { manager, adjudicator, holder, auditors: [a, b, c, d], outsider, failOracle };
  }
  const evidence = ethers.id("fixed evidence manifest");
  const grants = ethers.id("owner authorized grants");

  it("snapshots exactly four auditors while keeping votes and the substantive clock inactive", async function () {
    const f = await fixture();
    const review = await f.adjudicator.getReview(1, 1);
    expect(new Set(review.auditors).size).to.equal(4);
    expect(review.deadline).to.equal(0);
    expect((await f.adjudicator.getPreparation(1, 1)).deadline).to.be.greaterThan(0);
    await expect(f.manager.connect(f.auditors[0]).castVote(1, 1)).to.be.reverted;
    await expect(f.manager.finalizeExpiredManualReview(1)).to.be.reverted;
  });
  it("activation binds the set and grant commitments, preserves the panel and gives the full review duration", async function () {
    const f = await fixture();
    const before = await f.adjudicator.getReview(1, 1);
    await time.increase(86400);
    await f.adjudicator.activateReview(1, 1, evidence, grants);
    const after = await f.adjudicator.getReview(1, 1);
    const preparation = await f.adjudicator.getPreparation(1, 1);
    expect(after.auditors).to.deep.equal(before.auditors);
    expect(after.deadline - preparation.activatedAt).to.equal(await f.adjudicator.reviewDuration());
    expect(preparation.evidenceSetHash).to.equal(evidence);
    expect(preparation.grantCommitment).to.equal(grants);
    for (const wallet of after.auditors.slice(0, 3)) await f.manager.connect(await ethers.getSigner(wallet)).castVote(1, 1);
    expect((await f.manager.getClaim(1)).status).to.equal(7);
    await f.manager.connect(f.holder).withdrawSettlement(1);
    await expect(f.manager.connect(f.holder).withdrawSettlement(1)).to.be.reverted;
  });
  it("only the insurer may attest readiness and an active deadline cannot be reset", async function () {
    const f = await fixture();
    await expect(f.adjudicator.connect(f.outsider).activateReview(1, 1, evidence, grants)).to.be.reverted;
    await expect(f.adjudicator.activateReview(1, 1, ethers.ZeroHash, grants)).to.be.reverted;
    await f.adjudicator.activateReview(1, 1, evidence, grants);
    await expect(f.adjudicator.activateReview(1, 1, evidence, grants)).to.be.reverted;
    await expect(f.adjudicator.expirePreparation(1, 1)).to.be.reverted;
  });
  it("preparation expiry releases the reservation without a fraud verdict or reputation judgment", async function () {
    const f = await fixture();
    await time.increaseTo((await f.adjudicator.getPreparation(1, 1)).deadline + 1n);
    await expect(f.adjudicator.activateReview(1, 1, evidence, grants)).to.be.reverted;
    await f.adjudicator.connect(f.outsider).expirePreparation(1, 1);
    expect((await f.manager.getClaim(1)).status).to.equal(8);
    expect(await f.manager.rejectionReason(1)).to.equal(7);
    const economics = await ethers.getContractAt("PolicyEconomics", await f.manager.policyEconomics());
    expect((await economics.getClaimReservation(1)).reserved).to.equal(false);
    for (const auditor of f.auditors) expect(await f.adjudicator.auditorTotalVotes(auditor.address)).to.equal(0);
    await expect(f.adjudicator.expirePreparation(1, 1)).to.be.reverted;
  });
  it("allows only one preparation retry outside the ordinary appeal quota and isolates old versions", async function () {
    const f = await fixture();
    await time.increaseTo((await f.adjudicator.getPreparation(1, 1)).deadline + 1n);
    await f.adjudicator.expirePreparation(1, 1);
    await f.manager.connect(f.holder).submitAppeal(1, "retry-preparation");
    expect(await f.adjudicator.appealRound(1)).to.equal(0);
    expect(await f.adjudicator.preparationRetryUsed(1)).to.equal(true);
    await f.failOracle(); await f.manager.sendToManualReview(1);
    await expect(f.adjudicator.activateReview(1, 1, evidence, grants)).to.be.reverted;
    await time.increaseTo((await f.adjudicator.getPreparation(1, 2)).deadline + 1n);
    await f.adjudicator.expirePreparation(1, 2);
    await f.manager.connect(f.holder).submitAppeal(1, "ordinary-appeal");
    expect(await f.adjudicator.appealRound(1)).to.equal(1);
    await f.failOracle(); await f.manager.sendToManualReview(1);
    await time.increaseTo((await f.adjudicator.getPreparation(1, 3)).deadline + 1n);
    await f.adjudicator.expirePreparation(1, 3);
    await expect(f.manager.connect(f.holder).submitAppeal(1, "unbounded-retry")).to.be.reverted;
  });
});
