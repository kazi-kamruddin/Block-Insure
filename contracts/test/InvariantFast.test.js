const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mine } = require("@nomicfoundation/hardhat-network-helpers");

describe("InsuranceManager - Fast Invariant Checks", function () {
  async function deployFixture() {
    const [admin, user, oracle, auditor, secondAdmin] = await ethers.getSigners();
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
      await insuranceManager.ORACLE_ROLE(),
      oracle.address
    );
    await insuranceManager.grantProjectRole(
      await insuranceManager.AUDITOR_ROLE(),
      auditor.address
    );
    await insuranceManager.updateQuorumThreshold(1);

    return { insuranceManager, admin, user, oracle, auditor, secondAdmin };
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
    const { insuranceManager, oracle } = fixture;
    const claimId = await submitClaim(fixture, suffix);

    await insuranceManager.requestOracleVerification(claimId);
    const request = await insuranceManager.getOracleRequestByClaimId(claimId);
    await insuranceManager.connect(oracle).submitOracleResult(
      request.requestId,
      true,
      hashText(`oracle-${suffix}`),
      "LOW",
      "Hospital record matched"
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
    const { insuranceManager, auditor, oracle, user } = fixture;
    const claimId = await submitClaim(fixture, "auditor-invariant");

    await insuranceManager.requestOracleVerification(claimId);
    const request = await insuranceManager.getOracleRequestByClaimId(claimId);
    await insuranceManager.connect(oracle).submitOracleResult(
      request.requestId,
      false,
      hashText("oracle-failed-auditor-invariant"),
      "HIGH",
      "Hospital record mismatch"
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
    const { insuranceManager, oracle } = fixture;
    const claimId = await submitClaim(fixture, "oracle-timeout");

    await insuranceManager.updateOracleTimeoutBlocks(1);
    await insuranceManager.requestOracleVerification(claimId);
    const request = await insuranceManager.getOracleRequestByClaimId(claimId);

    await mine(2);
    await insuranceManager.resolveTimedOutOracle(claimId);

    const failedClaim = await insuranceManager.getClaim(claimId);
    expect(failedClaim.status).to.equal(5);
    await expect(
      insuranceManager.connect(oracle).submitOracleResult(
        request.requestId,
        true,
        hashText("late-oracle"),
        "LOW",
        "Late oracle response"
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
