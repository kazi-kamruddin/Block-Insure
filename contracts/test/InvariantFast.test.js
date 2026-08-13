const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mine } = require("@nomicfoundation/hardhat-network-helpers");
const {
  configureOracleFixture,
  finalizeExactResult,
} = require("./helpers/oracleCoordinator");

describe("InsuranceManager - Fast Invariant Checks", function () {
  async function deployFixture() {
    const [admin, user, oracle, auditor, secondAdmin, secondOracle] = await ethers.getSigners();
    const InsuranceManager = await ethers.getContractFactory("InsuranceManager");
    const insuranceManager = await InsuranceManager.deploy();
    const premium = ethers.parseEther("0.01");

    await insuranceManager.createPolicyPackage(
      "Health Basic",
      "HEALTH",
      premium,
      ethers.parseEther("1"),
      365,
      "HOSPITAL_BILL"
    );
    await insuranceManager.connect(user).purchasePolicy(1, { value: premium });

    await insuranceManager.grantProjectRole(
      await insuranceManager.AUDITOR_ROLE(),
      auditor.address
    );
    const coordinator = await configureOracleFixture(
      insuranceManager,
      admin,
      [oracle, secondOracle]
    );

    return { insuranceManager, coordinator, admin, user, oracle, secondOracle, auditor, secondAdmin };
  }

  const hashText = (value) => ethers.keccak256(ethers.toUtf8Bytes(value));

  async function submitClaim(fixture, suffix) {
    const { insuranceManager, user } = fixture;
    const policy = await insuranceManager.getPolicy(1);
    const claimId = await insuranceManager.claimCounter();

    await insuranceManager.connect(user).submitClaim(
      1,
      ethers.parseEther("0.2"),
      policy.startDate,
      `TYPE-${suffix}`,
      `HOSP-${suffix}`,
      hashText(`invoice-${suffix}`),
      hashText(`document-${suffix}`),
      `ipfs://document-${suffix}`
    );

    return claimId;
  }

  async function approveClaim(fixture, suffix) {
    const { insuranceManager, coordinator, oracle, secondOracle } = fixture;
    const claimId = await submitClaim(fixture, suffix);

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

  it("never allows settlement before approval or a second settlement", async function () {
    const fixture = await deployFixture();
    const { insuranceManager } = fixture;
    const pendingClaimId = await submitClaim(fixture, "before-approval");

    await expect(insuranceManager.settleClaim(pendingClaimId)).to.be.reverted;

    const approvedClaimId = await approveClaim(fixture, "double-settle");
    await insuranceManager.fundContract({ value: ethers.parseEther("0.5") });
    await insuranceManager.settleClaim(approvedClaimId);

    const settledClaim = await insuranceManager.getClaim(approvedClaimId);
    expect(settledClaim.status).to.equal(9);
    await expect(insuranceManager.settleClaim(approvedClaimId)).to.be.reverted;
  });

  it("never allows duplicate auditor votes or votes after closure", async function () {
    const fixture = await deployFixture();
    const { insuranceManager, coordinator, auditor, oracle, secondOracle, user } = fixture;
    const claimId = await submitClaim(fixture, "auditor-invariant");

    await insuranceManager.requestOracleVerification(claimId);
    const request = await coordinator.getRequestByClaimId(claimId);
    await finalizeExactResult(
      coordinator,
      request.requestId,
      [oracle, secondOracle],
      false,
      hashText("oracle-failed-auditor-invariant")
    );

    await insuranceManager.connect(auditor).castVote(claimId, 1);
    await expect(
      insuranceManager.connect(auditor).castVote(claimId, 2)
    ).to.be.reverted;

    await insuranceManager.rejectClaim(claimId, hashText("reject-after-vote"));
    await insuranceManager.connect(user).submitAppeal(claimId, "ipfs://appeal");
    await insuranceManager.finalizeRejectedAppeal(claimId);
    await insuranceManager.closeClaim(claimId);

    await expect(
      insuranceManager.connect(auditor).castVote(claimId, 1)
    ).to.be.reverted;
  });

  it("never accepts oracle confirmations after timeout finalization", async function () {
    const fixture = await deployFixture();
    const { insuranceManager, coordinator, oracle } = fixture;
    const claimId = await submitClaim(fixture, "oracle-timeout");

    await coordinator.updateConsensusConfig(2, 1, 1);
    await insuranceManager.requestOracleVerification(claimId);
    const request = await coordinator.getRequestByClaimId(claimId);

    await mine(3);
    await coordinator.resolveTimedOutRequest(claimId);

    const failedClaim = await insuranceManager.getClaim(claimId);
    expect(failedClaim.status).to.equal(5);
    await expect(
      coordinator.connect(oracle).commitOracleResult(
        request.requestId,
        hashText("late-oracle")
      )
    ).to.be.reverted;
  });

  it("never permits removal of the final admin role holder", async function () {
    const { insuranceManager, admin, secondAdmin } = await deployFixture();
    const adminRole = await insuranceManager.ADMIN_ROLE();

    await expect(
      insuranceManager.revokeProjectRole(adminRole, admin.address)
    ).to.be.reverted;

    await insuranceManager.grantProjectRole(adminRole, secondAdmin.address);
    await insuranceManager.revokeProjectRole(adminRole, admin.address);

    expect(await insuranceManager.hasRole(adminRole, admin.address)).to.equal(false);
    expect(await insuranceManager.hasRole(adminRole, secondAdmin.address)).to.equal(true);
  });
});
