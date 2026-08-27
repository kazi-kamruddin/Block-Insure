const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  configureOracleFixture,
  finalizeExactResult,
} = require("./helpers/oracleCoordinator");

describe("Phase 6 - protocol state-machine invariants", function () {
  const hash = (value) => ethers.keccak256(ethers.toUtf8Bytes(value));
  const premium = ethers.parseEther("0.01");
  const coverage = ethers.parseEther("1");

  async function deployFixture() {
    const [admin, claimant, other, oracle1, oracle2, auditor1, auditor2, auditor3, auditor4] =
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
    await manager.createPolicyPackage(
      "Stateful Health",
      "HEALTH",
      premium,
      coverage,
      365,
      "HOSPITAL_BILL"
    );
    await manager.connect(claimant).purchasePolicy(1, { value: premium });
    await manager.fundContract({ value: ethers.parseEther("2") });
    const economics = await ethers.getContractAt("PolicyEconomics", await manager.policyEconomics());
    return {
      manager,
      adjudicator,
      coordinator,
      economics,
      admin,
      claimant,
      other,
      oracles: [oracle1, oracle2],
      auditors,
    };
  }

  async function submitClaim(fixture, step, amount) {
    await time.increase(1);
    const incidentDate = await time.latest();
    await fixture.manager.connect(fixture.claimant).submitClaim(
      1,
      amount,
      incidentDate,
      "HOSPITALIZATION",
      "HOSP-STATEFUL",
      hash(`stateful-invoice-${step}`),
      hash(`stateful-document-${step}`),
      `ipfs://stateful-${step}`
    );
    return (await fixture.manager.claimCounter()) - 1n;
  }

  async function decideWithOracle(fixture, claimId, verified, suffix) {
    expect((await fixture.manager.getClaim(claimId)).status).to.equal(1n);
    await fixture.manager.requestOracleVerification(claimId);
    const request = await fixture.coordinator.getRequestByClaimId(claimId);
    await finalizeExactResult(
      fixture.coordinator,
      request.requestId,
      fixture.oracles,
      verified,
      hash(`${suffix}-${claimId}-${request.claimVersion}`)
    );
  }

  async function assignedAuditors(fixture, claimId) {
    const version = await fixture.manager.claimVersion(claimId);
    const review = await fixture.adjudicator.getReview(claimId, version);
    return review.auditors.map((address) =>
      fixture.auditors.find((auditor) => auditor.address.toLowerCase() === address.toLowerCase())
    );
  }

  async function assertAccountingInvariants(fixture, claimIds) {
    const account = await fixture.economics.getCoverageAccount(1);
    expect(account.reservedCoverageWei + account.settledCoverageWei).to.be.lte(
      account.coverageLimitWei
    );
    expect(await fixture.economics.totalReservedCoverageWei()).to.equal(
      account.reservedCoverageWei
    );
    expect(await fixture.economics.minimumTreasuryBalance(
      await fixture.adjudicator.totalUnfundedLiabilityWei()
    )).to.be.gte(
      account.reservedCoverageWei
    );

    let expectedOutstanding = 0n;
    let expectedUnfunded = 0n;
    let expectedClaimable = 0n;
    for (const claimId of claimIds) {
      const allocated = await fixture.adjudicator.allocatedSettlementWei(claimId);
      const withdrawn = await fixture.adjudicator.withdrawnSettlementWei(claimId);
      const funded = await fixture.adjudicator.fundedSettlement(claimId);
      expectedOutstanding += allocated - withdrawn;
      if (allocated > 0n && withdrawn === 0n) {
        if (funded) expectedClaimable += allocated;
        else expectedUnfunded += allocated;
      }
      expect(withdrawn).to.be.lte(allocated);
    }
    expect(await fixture.adjudicator.totalOutstandingLiabilityWei()).to.equal(expectedOutstanding);
    expect(await fixture.adjudicator.totalUnfundedLiabilityWei()).to.equal(expectedUnfunded);
    expect(await fixture.adjudicator.claimableSettlementWei(fixture.claimant.address)).to.equal(
      expectedClaimable
    );
  }

  it("preserves cross-contract accounting across generated approval, rejection, appeal, and payout sequences", async function () {
    const fixture = await deployFixture();
    const claimIds = [];
    let state = 0x5eedc0de;

    // The protocol intentionally caps each policy at five claims. The fixed seed
    // covers oracle approval, manual approval, rejection, appeal, and withdrawal.
    for (let step = 0; step < 5; step += 1) {
      state = (state * 1664525 + 1013904223) >>> 0;
      const amount = ethers.parseEther((0.012 + (state % 9) / 1000).toFixed(3));
      const claimId = await submitClaim(fixture, step, amount);
      claimIds.push(claimId);
      const oracleApproved = state % 3 === 0;
      await decideWithOracle(fixture, claimId, oracleApproved, `initial-${step}`);

      if (!oracleApproved) {
        await fixture.manager.sendToManualReview(claimId);
        const assigned = await assignedAuditors(fixture, claimId);
        if (state % 2 === 0) {
          for (const auditor of assigned.slice(0, 3)) {
            await fixture.manager.connect(auditor).castVote(claimId, 1);
          }
        } else {
          await fixture.manager.connect(assigned[0]).castVote(claimId, 2);
          await fixture.manager.connect(assigned[1]).castVote(claimId, 2);
          if (step % 5 === 0) {
            await fixture.manager.connect(fixture.claimant).submitAppeal(
              claimId,
              `ipfs://stateful-appeal-${step}`
            );
            await finalizeExactResult(
              fixture.coordinator,
              (await fixture.coordinator.getRequestByClaimId(claimId)).requestId,
              fixture.oracles,
              true,
              hash(`appeal-approved-${step}`)
            );
          }
        }
      }

      if ((await fixture.manager.getClaim(claimId)).status === 7n && state % 4 !== 0) {
        await fixture.manager.connect(fixture.claimant).withdrawSettlement(claimId);
      }
      await assertAccountingInvariants(fixture, claimIds);
    }
  });

  it("never permits repeated finalization, voting, appeal, or payout actions", async function () {
    const fixture = await deployFixture();
    const approvedClaim = await submitClaim(fixture, "approved-once", ethers.parseEther("0.05"));
    await decideWithOracle(fixture, approvedClaim, true, "approved-once");
    await fixture.manager.connect(fixture.claimant).withdrawSettlement(approvedClaim);
    await expect(
      fixture.manager.connect(fixture.claimant).withdrawSettlement(approvedClaim)
    ).to.be.reverted;

    const rejectedClaim = await submitClaim(fixture, "rejected-once", ethers.parseEther("0.05"));
    await decideWithOracle(fixture, rejectedClaim, false, "rejected-once");
    await fixture.manager.sendToManualReview(rejectedClaim);
    const assigned = await assignedAuditors(fixture, rejectedClaim);
    await fixture.manager.connect(assigned[0]).castVote(rejectedClaim, 2);
    await expect(
      fixture.manager.connect(assigned[0]).castVote(rejectedClaim, 2)
    ).to.be.reverted;
    await fixture.manager.connect(assigned[1]).castVote(rejectedClaim, 2);
    await fixture.manager.connect(fixture.claimant).submitAppeal(
      rejectedClaim,
      "ipfs://single-appeal"
    );
    await expect(
      fixture.manager.connect(fixture.claimant).submitAppeal(rejectedClaim, "ipfs://second-appeal")
    ).to.be.reverted;
  });

  it("keeps privileged finalization entry points inaccessible to arbitrary callers", async function () {
    const fixture = await deployFixture();
    const claimId = await submitClaim(fixture, "oracle-access", ethers.parseEther("0.05"));
    await fixture.manager.requestOracleVerification(claimId);
    const request = await fixture.coordinator.getRequestByClaimId(claimId);
    await expect(
      fixture.manager.connect(fixture.other).finalizeOracleResult(
        request.requestId,
        claimId,
        true,
        hash("unauthorized"),
        1
      )
    ).to.be.reverted;

    const reviewClaimId = await submitClaim(fixture, "adjudicator-access", ethers.parseEther("0.05"));
    await decideWithOracle(fixture, reviewClaimId, false, "adjudicator-access");
    await fixture.manager.sendToManualReview(reviewClaimId);
    await expect(
      fixture.manager.connect(fixture.other).finalizeManualReview(reviewClaimId, 1, true, 1)
    ).to.be.reverted;
  });
});
