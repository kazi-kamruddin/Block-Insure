const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  configureOracleFixture,
  finalizeExactResult,
} = require("./helpers/oracleCoordinator");

describe("Phase 2 - Automatic adjudication", function () {
  const hash = (value) => ethers.keccak256(ethers.toUtf8Bytes(value));

  async function deployFixture({ fund = true } = {}) {
    const [admin, user, publicCaller, oracle1, oracle2, auditor1, auditor2, auditor3, auditor4] =
      await ethers.getSigners();
    const Manager = await ethers.getContractFactory("InsuranceManager");
    const manager = await Manager.deploy();
    const Adjudicator = await ethers.getContractFactory("ClaimAdjudicator");
    const adjudicator = await Adjudicator.deploy(await manager.getAddress());
    await manager.configureClaimAdjudicator(await adjudicator.getAddress());

    const coordinator = await configureOracleFixture(manager, admin, [oracle1, oracle2], {
      threshold: 2,
      commitBlocks: 8,
      revealBlocks: 8,
    });
    const auditorRole = await manager.AUDITOR_ROLE();
    const auditors = [auditor1, auditor2, auditor3, auditor4];
    for (const auditor of auditors) {
      await manager.grantProjectRole(auditorRole, auditor.address);
    }

    const premium = ethers.parseEther("0.01");
    await manager.createPolicyPackage(
      "Health Basic",
      "HEALTH",
      premium,
      ethers.parseEther("1"),
      365,
      "HOSPITAL_BILL"
    );
    await manager.connect(user).purchasePolicy(1, { value: premium });
    if (fund) await manager.fundContract({ value: ethers.parseEther("0.5") });

    return {
      manager,
      adjudicator,
      coordinator,
      admin,
      user,
      publicCaller,
      oracle1,
      oracle2,
      auditors,
      premium,
    };
  }

  async function submitClaim(fixture, suffix = "base") {
    const policy = await fixture.manager.getPolicy(1);
    await fixture.manager.connect(fixture.user).submitClaim(
      1,
      ethers.parseEther("0.2"),
      policy.startDate,
      "HOSPITALIZATION",
      "HOSP-001",
      hash(`invoice-${suffix}`),
      hash(`document-${suffix}`),
      `ipfs://document-${suffix}`
    );
    return (await fixture.manager.claimCounter()) - 1n;
  }

  async function decideWithOracles(fixture, claimId, verified, suffix = "decision") {
    await fixture.manager.requestOracleVerification(claimId);
    const request = await fixture.coordinator.getRequestByClaimId(claimId);
    await finalizeExactResult(
      fixture.coordinator,
      request.requestId,
      [fixture.oracle1, fixture.oracle2],
      verified,
      hash(`${suffix}-${request.claimVersion}`)
    );
    return request;
  }

  async function openFailedReview(fixture, claimId) {
    await decideWithOracles(fixture, claimId, false, "failed");
    await fixture.manager.sendToManualReview(claimId);
    return fixture.adjudicator.getReview(claimId, await fixture.manager.claimVersion(claimId));
  }

  it("removes every administrative approval, rejection, settlement, and closure entry point", async function () {
    const fixture = await deployFixture();
    const functionNames = new Set(
      fixture.manager.interface.fragments
        .filter((fragment) => fragment.type === "function")
        .map((fragment) => fragment.name)
    );
    for (const forbidden of [
      "approveClaim",
      "rejectClaim",
      "settleClaim",
      "closeClaim",
      "approveHighValueSettlement",
    ]) {
      expect(functionNames.has(forbidden)).to.equal(false);
    }
  });

  it("turns exact oracle success into a funded pull-payment entitlement in the same transaction", async function () {
    const fixture = await deployFixture();
    const claimId = await submitClaim(fixture);
    await decideWithOracles(fixture, claimId, true);

    expect((await fixture.manager.getClaim(claimId)).status).to.equal(7); // PAYOUT_READY
    const allocation = await fixture.adjudicator.allocatedSettlementWei(claimId);
    expect(allocation).to.be.greaterThan(0);
    expect(await fixture.adjudicator.claimableSettlementWei(fixture.user.address)).to.equal(allocation);

    await expect(fixture.manager.connect(fixture.user).withdrawSettlement(claimId))
      .to.emit(fixture.manager, "SettlementWithdrawn")
      .withArgs(claimId, fixture.user.address, allocation, (value) => value > 0n);
    expect((await fixture.manager.getClaim(claimId)).status).to.equal(9); // SETTLED
    expect(await fixture.adjudicator.withdrawnSettlementWei(claimId)).to.equal(allocation);
  });

  it("uses FUNDING_REQUIRED without rejecting a valid underfunded claim", async function () {
    const fixture = await deployFixture({ fund: false });
    const claimId = await submitClaim(fixture, "underfunded");
    await decideWithOracles(fixture, claimId, true, "underfunded");
    expect((await fixture.manager.getClaim(claimId)).status).to.equal(11); // FUNDING_REQUIRED

    await fixture.manager.fundContract({ value: ethers.parseEther("0.2") });
    await fixture.manager.connect(fixture.publicCaller).activateFundedClaim(claimId);
    expect((await fixture.manager.getClaim(claimId)).status).to.equal(7);
  });

  it("finalizes three approvals automatically and keeps the four-auditor snapshot immutable", async function () {
    const fixture = await deployFixture();
    const claimId = await submitClaim(fixture, "approval-review");
    const review = await openFailedReview(fixture, claimId);
    expect(review.auditors.filter((address) => address !== ethers.ZeroAddress)).to.have.length(4);

    const revoked = fixture.auditors.find(
      (auditor) => auditor.address.toLowerCase() === review.auditors[0].toLowerCase()
    );
    await fixture.manager.revokeProjectRole(await fixture.manager.AUDITOR_ROLE(), revoked.address);
    const assigned = review.auditors.map((address) =>
      fixture.auditors.find((auditor) => auditor.address.toLowerCase() === address.toLowerCase())
    );
    for (const auditor of assigned.slice(0, 3)) {
      await fixture.manager.connect(auditor).castVote(claimId, 1);
    }
    expect((await fixture.manager.getClaim(claimId)).status).to.equal(7);
  });

  it("rejects automatically after two rejections, including a two-two split", async function () {
    const fixture = await deployFixture();
    const claimId = await submitClaim(fixture, "split");
    const review = await openFailedReview(fixture, claimId);
    const assigned = review.auditors.map((address) =>
      fixture.auditors.find((auditor) => auditor.address.toLowerCase() === address.toLowerCase())
    );
    await fixture.manager.connect(assigned[0]).castVote(claimId, 1);
    await fixture.manager.connect(assigned[1]).castVote(claimId, 1);
    await fixture.manager.connect(assigned[2]).castVote(claimId, 2);
    await fixture.manager.connect(assigned[3]).castVote(claimId, 2);
    expect((await fixture.manager.getClaim(claimId)).status).to.equal(8);
    expect(await fixture.manager.rejectionReason(claimId)).to.equal(4);
  });

  it("lets anyone route an oracle failure after the SLA and reject an expired review", async function () {
    const fixture = await deployFixture();
    await fixture.adjudicator.updateConfig(100, 100);
    const claimId = await submitClaim(fixture, "liveness");
    await decideWithOracles(fixture, claimId, false, "liveness");
    await expect(
      fixture.manager.connect(fixture.publicCaller).sendToManualReview(claimId)
    ).to.be.reverted;
    await time.increase(101);
    await fixture.manager.connect(fixture.publicCaller).sendToManualReview(claimId);
    await time.increase(101);
    await fixture.manager.connect(fixture.publicCaller).finalizeExpiredManualReview(claimId);
    expect((await fixture.manager.getClaim(claimId)).status).to.equal(8);
    expect(await fixture.manager.rejectionReason(claimId)).to.equal(5);
  });

  it("appeals preserve the rejected decision and immediately open a new claim version request", async function () {
    const fixture = await deployFixture();
    const claimId = await submitClaim(fixture, "appeal");
    const review = await openFailedReview(fixture, claimId);
    const assigned = review.auditors.map((address) =>
      fixture.auditors.find((auditor) => auditor.address.toLowerCase() === address.toLowerCase())
    );
    await fixture.manager.connect(assigned[0]).castVote(claimId, 2);
    await fixture.manager.connect(assigned[1]).castVote(claimId, 2);
    const originalDecision = await fixture.adjudicator.getDecision(claimId, 1);

    await fixture.manager
      .connect(fixture.user)
      .submitAppealWithEvidence(claimId, "ipfs://appeal-reason", hash("appeal-evidence"), "ipfs://appeal");
    expect(await fixture.manager.claimVersion(claimId)).to.equal(2);
    expect((await fixture.manager.getClaim(claimId)).status).to.equal(3); // ORACLE_PENDING
    expect((await fixture.coordinator.getRequestByClaimId(claimId)).claimVersion).to.equal(2);
    expect((await fixture.adjudicator.getDecision(claimId, 1)).decisionHash).to.equal(
      originalDecision.decisionHash
    );
    expect((await fixture.manager.getClaimDocuments(claimId)).length).to.equal(2);
    const appealRequest = await fixture.coordinator.getRequestByClaimId(claimId);
    await finalizeExactResult(
      fixture.coordinator,
      appealRequest.requestId,
      [fixture.oracle1, fixture.oracle2],
      true,
      hash("appeal-success-result")
    );
    expect((await fixture.manager.getClaim(claimId)).status).to.equal(7);
    await fixture.manager.connect(fixture.user).withdrawSettlement(claimId);
    expect((await fixture.manager.getClaim(claimId)).status).to.equal(9);
  });

  it("a reverting claimant cannot block automatic finalization", async function () {
    const fixture = await deployFixture();
    const RevertingClaimant = await ethers.getContractFactory("RevertingClaimant");
    const claimant = await RevertingClaimant.deploy();
    await claimant.purchase(await fixture.manager.getAddress(), 1, { value: fixture.premium });
    const policy = await fixture.manager.getPolicy(2);
    await claimant.submit(await fixture.manager.getAddress(), 2, policy.startDate);
    const claimId = (await fixture.manager.claimCounter()) - 1n;
    await decideWithOracles(fixture, claimId, true, "reverting");
    expect((await fixture.manager.getClaim(claimId)).status).to.equal(7);
    await expect(claimant.withdraw(await fixture.manager.getAddress(), claimId)).to.be.reverted;
    expect((await fixture.manager.getClaim(claimId)).status).to.equal(7);
  });
});
