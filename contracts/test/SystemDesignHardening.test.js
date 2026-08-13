const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const {
  configureOracleFixture,
  finalizeExactResult,
} = require("./helpers/oracleCoordinator");

describe("InsuranceManager - Section 1 System Design Hardening", function () {
  async function deployFixture() {
    const [admin, emergency, user, otherUser, oracle, secondOracle] = await ethers.getSigners();
    const InsuranceManager = await ethers.getContractFactory("InsuranceManager");
    const insuranceManager = await InsuranceManager.deploy();
    const premium = ethers.parseEther("0.01");
    const coverage = ethers.parseEther("1");

    await insuranceManager.createPolicyPackage(
      "Health Basic",
      "HEALTH",
      premium,
      coverage,
      365,
      "HOSPITAL_BILL"
    );
    await insuranceManager.connect(user).purchasePolicy(1, { value: premium });

    const coordinator = await configureOracleFixture(
      insuranceManager,
      admin,
      [oracle, secondOracle]
    );

    return {
      insuranceManager,
      coordinator,
      admin,
      emergency,
      user,
      otherUser,
      oracle,
      secondOracle,
      premium,
      coverage,
      policy: await insuranceManager.getPolicy(1),
    };
  }

  const hashText = (value) => ethers.keccak256(ethers.toUtf8Bytes(value));

  async function submitCleanClaim(fixture, suffix, amount = ethers.parseEther("0.2")) {
    const { insuranceManager, user, policy } = fixture;
    const claimId = await insuranceManager.claimCounter();

    await insuranceManager.connect(user).submitClaim(
      1,
      amount,
      policy.startDate,
      `TYPE-${suffix}`,
      `HOSP-${suffix}`,
      hashText(`invoice-${suffix}`),
      hashText(`document-${suffix}`),
      `ipfs://document-${suffix}`
    );

    return claimId;
  }

  async function createApprovedClaim(fixture, suffix) {
    const { insuranceManager, coordinator, oracle, secondOracle } = fixture;
    const claimId = await submitCleanClaim(fixture, suffix);

    await insuranceManager.requestOracleVerification(claimId);
    const request = await coordinator.getRequestByClaimId(claimId);
    await finalizeExactResult(
      coordinator,
      request.requestId,
      [oracle, secondOracle],
      true,
      hashText(`oracle-${suffix}`)
    );
    await insuranceManager.approveClaim(claimId);

    return claimId;
  }

  it("persists policy expiry through a permissionless call", async function () {
    const fixture = await deployFixture();
    const { insuranceManager, otherUser, policy } = fixture;

    await time.increaseTo(policy.endDate + 1n);

    await expect(insuranceManager.connect(otherUser).deactivateExpiredPolicy(1))
      .to.emit(insuranceManager, "PolicyExpired")
      .withArgs(1, anyValue);

    expect((await insuranceManager.getPolicy(1)).isActive).to.equal(false);
  });

  it("enforces a configurable maximum claim count per policy", async function () {
    const fixture = await deployFixture();
    const { insuranceManager } = fixture;

    await insuranceManager.updateMaxClaimsPerPolicy(2);
    await submitCleanClaim(fixture, "limit-1");
    await submitCleanClaim(fixture, "limit-2");

    await expect(submitCleanClaim(fixture, "limit-3")).to.be.reverted;
    expect(await insuranceManager.claimCountPerPolicy(1)).to.equal(2);
  });

  it("emits a reserve warning after settlement drops below the threshold", async function () {
    const fixture = await deployFixture();
    const { insuranceManager } = fixture;
    const claimId = await createApprovedClaim(fixture, "reserve");
    const threshold = ethers.parseEther("1");

    await insuranceManager.updateReserveWarningThreshold(threshold);
    await insuranceManager.fundContract({ value: ethers.parseEther("0.2") });

    await expect(insuranceManager.settleClaim(claimId))
      .to.emit(insuranceManager, "ReserveLowWarning")
      .withArgs(anyValue, threshold);
  });

  it("allows admins to close settled claims immediately", async function () {
    const fixture = await deployFixture();
    const { insuranceManager, admin } = fixture;
    const claimId = await createApprovedClaim(fixture, "settled-close");

    await insuranceManager.fundContract({ value: ethers.parseEther("0.2") });
    await insuranceManager.settleClaim(claimId);

    await expect(insuranceManager.closeClaim(claimId))
      .to.emit(insuranceManager, "ClaimClosed")
      .withArgs(claimId, admin.address, anyValue);

    expect((await insuranceManager.getClaim(claimId)).status).to.equal(10);
  });

  it("protects rejected claims during the appeal window", async function () {
    const fixture = await deployFixture();
    const { insuranceManager } = fixture;
    const claimId = await submitCleanClaim(fixture, "rejected-window");

    await insuranceManager.updateClaimClosureWindow(60);
    await insuranceManager.rejectClaim(claimId, hashText("rejected"));

    await expect(insuranceManager.closeClaim(claimId)).to.be.reverted;

    await time.increase(61);
    await insuranceManager.closeClaim(claimId);

    expect((await insuranceManager.getClaim(claimId)).status).to.equal(10);
  });

  it("allows closure after a rejected appeal has been finalized", async function () {
    const fixture = await deployFixture();
    const { insuranceManager, user } = fixture;
    const claimId = await submitCleanClaim(fixture, "appealed-close");

    await insuranceManager.rejectClaim(claimId, hashText("rejected"));
    await insuranceManager.connect(user).submitAppeal(claimId, "ipfs://appeal");

    await expect(insuranceManager.closeClaim(claimId)).to.be.reverted;

    await insuranceManager.finalizeRejectedAppeal(claimId);
    await insuranceManager.closeClaim(claimId);

    expect((await insuranceManager.getClaim(claimId)).status).to.equal(10);
  });

  it("lets emergency responders pause but reserves unpause for admins", async function () {
    const fixture = await deployFixture();
    const { insuranceManager, coordinator, emergency, oracle } = fixture;
    const approvedClaimId = await createApprovedClaim(fixture, "pause-settle");
    const pendingClaimId = await submitCleanClaim(fixture, "pause-oracle");

    await insuranceManager.requestOracleVerification(pendingClaimId);
    const request = await coordinator.getRequestByClaimId(pendingClaimId);
    await insuranceManager.fundContract({ value: ethers.parseEther("0.2") });

    const EMERGENCY_ROLE = await insuranceManager.EMERGENCY_ROLE();
    await insuranceManager.grantProjectRole(EMERGENCY_ROLE, emergency.address);
    await insuranceManager.connect(emergency).pause();

    await expect(
      coordinator.connect(oracle).commitOracleResult(
        request.requestId,
        hashText("paused-oracle")
      )
    ).to.be.reverted;

    await expect(
      insuranceManager.settleClaim(approvedClaimId)
    ).to.be.revertedWithCustomError(insuranceManager, "EnforcedPause");

    await expect(insuranceManager.connect(emergency).unpause()).to.be.reverted;
    await insuranceManager.unpause();
  });

  it("removes the record-only settlement API", async function () {
    const { insuranceManager } = await deployFixture();

    expect(insuranceManager.interface.hasFunction("recordOnlySettlement")).to.equal(false);
    expect(insuranceManager.interface.hasEvent("ClaimSettledRecordOnly")).to.equal(false);
  });
});
