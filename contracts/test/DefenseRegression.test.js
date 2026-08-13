const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mine, time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  configureOracleFixture,
  finalizeExactResult,
} = require("./helpers/oracleCoordinator");

describe("InsuranceManager - Defense Regression Edges", function () {
  async function deployFixture() {
    const [admin, user, otherUser, oracle, auditor, secondOracle] = await ethers.getSigners();
    const InsuranceManager = await ethers.getContractFactory("InsuranceManager");
    const insuranceManager = await InsuranceManager.deploy();
    const premium = ethers.parseEther("0.01");
    const coverage = ethers.parseEther("1");

    await insuranceManager.createPolicyPackage(
      "Health Basic",
      "Health",
      premium,
      coverage,
      365,
      "Hospital Bill"
    );
    await insuranceManager.connect(user).purchasePolicy(1, { value: premium });
    await insuranceManager.grantProjectRole(await insuranceManager.AUDITOR_ROLE(), auditor.address);
    const coordinator = await configureOracleFixture(
      insuranceManager,
      admin,
      [oracle, secondOracle]
    );

    return { insuranceManager, coordinator, admin, user, otherUser, oracle, secondOracle, auditor, premium };
  }

  async function submitClaim(insuranceManager, user, seed = "regression", policyId = 1) {
    const policy = await insuranceManager.getPolicy(policyId);
    const tx = await insuranceManager.connect(user).submitClaim(
      policyId,
      ethers.parseEther("0.2"),
      policy.startDate,
      "HOSPITALIZATION",
      "HOSP-001",
      ethers.keccak256(ethers.toUtf8Bytes(`${seed}-invoice`)),
      ethers.keccak256(ethers.toUtf8Bytes(`${seed}-document`)),
      `Qm${seed}`
    );
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log) => {
        try {
          return insuranceManager.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((log) => log?.name === "ClaimSubmitted");

    return event.args.claimId;
  }

  async function verifyClaim(fixture, claimId, seed = "verified") {
    const { insuranceManager, coordinator, oracle, secondOracle } = fixture;
    const requestTx = await insuranceManager.requestOracleVerification(claimId);
    const receipt = await requestTx.wait();
    const event = receipt.logs
      .map((log) => {
        try {
          return insuranceManager.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((log) => log?.name === "OracleRequested");

    await finalizeExactResult(
      coordinator,
      event.args.requestId,
      [oracle, secondOracle],
      true,
      ethers.keccak256(ethers.toUtf8Bytes(seed))
    );

    return event.args.requestId;
  }

  async function failClaimOracle(fixture, claimId, seed = "failed") {
    const { insuranceManager, coordinator, oracle, secondOracle } = fixture;
    const requestTx = await insuranceManager.requestOracleVerification(claimId);
    const receipt = await requestTx.wait();
    const event = receipt.logs
      .map((log) => {
        try {
          return insuranceManager.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((log) => log?.name === "OracleRequested");

    await finalizeExactResult(
      coordinator,
      event.args.requestId,
      [oracle, secondOracle],
      false,
      ethers.keccak256(ethers.toUtf8Bytes(seed))
    );
  }

  it("does not let rejected claims settle or active claims close early", async function () {
    const { insuranceManager, user } = await deployFixture();
    const claimId = await submitClaim(insuranceManager, user, "reject-edge");

    await expect(insuranceManager.closeClaim(claimId)).to.be.reverted;
    await insuranceManager.rejectClaim(
      claimId,
      ethers.keccak256(ethers.toUtf8Bytes("not covered"))
    );
    await expect(insuranceManager.settleClaim(claimId)).to.be.reverted;
  });

  it("blocks duplicate votes, duplicate appeals, and final admin removal", async function () {
    const fixture = await deployFixture();
    const { insuranceManager, user, auditor, admin } = fixture;
    const claimId = await submitClaim(insuranceManager, user, "appeal-vote-edge");

    await failClaimOracle(fixture, claimId);
    await insuranceManager.connect(auditor).castVote(claimId, 1);
    await expect(insuranceManager.connect(auditor).castVote(claimId, 2)).to.be.reverted;

    await insuranceManager.rejectClaim(
      claimId,
      ethers.keccak256(ethers.toUtf8Bytes("appealable"))
    );
    await insuranceManager.connect(user).submitAppeal(claimId, "ipfs://appeal-1");
    await expect(
      insuranceManager.connect(user).submitAppeal(claimId, "ipfs://appeal-2")
    ).to.be.reverted;

    await expect(
      insuranceManager.revokeProjectRole(await insuranceManager.ADMIN_ROLE(), admin.address)
    ).to.be.reverted;
  });

  it("blocks oracle submissions after timeout finalization", async function () {
    const { insuranceManager, coordinator, user, oracle } = await deployFixture();
    const claimId = await submitClaim(insuranceManager, user, "oracle-timeout-edge");
    await coordinator.updateConsensusConfig(2, 1, 1);
    const requestTx = await insuranceManager.requestOracleVerification(claimId);
    const receipt = await requestTx.wait();
    const requestEvent = receipt.logs
      .map((log) => {
        try {
          return insuranceManager.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((log) => log?.name === "OracleRequested");

    await mine(3);
    await coordinator.resolveTimedOutRequest(claimId);

    await expect(
      coordinator.connect(oracle).commitOracleResult(
        requestEvent.args.requestId,
        ethers.keccak256(ethers.toUtf8Bytes("late-result"))
      )
    ).to.be.reverted;
  });

  it("blocks claims outside period and while overdue or lapsed", async function () {
    const { insuranceManager, user } = await deployFixture();
    const policy = await insuranceManager.getPolicy(1);

    await expect(
      insuranceManager.connect(user).submitClaim(
        1,
        ethers.parseEther("0.1"),
        policy.startDate - 1n,
        "HOSPITALIZATION",
        "HOSP-001",
        ethers.keccak256(ethers.toUtf8Bytes("before-invoice")),
        ethers.keccak256(ethers.toUtf8Bytes("before-document")),
        "QmBefore"
      )
    ).to.be.reverted;

    await time.increaseTo(policy.nextPremiumDueDate + 1n);
    await expect(submitClaim(insuranceManager, user, "grace-blocked")).to.be.reverted;

    await time.increaseTo(policy.gracePeriodEnd + 1n);
    await expect(submitClaim(insuranceManager, user, "lapsed-blocked")).to.be.reverted;
  });

  it("keeps premium lifecycle compatible with claim, oracle, approval, and settlement", async function () {
    const fixture = await deployFixture();
    const { insuranceManager, user, premium } = fixture;
    const policy = await insuranceManager.getPolicy(1);

    await time.increaseTo(policy.nextPremiumDueDate - 1n);
    await insuranceManager.connect(user).payPremium(1, { value: premium });

    const claimId = await submitClaim(insuranceManager, user, "full-flow");
    await verifyClaim(fixture, claimId, "full-flow-result");
    await insuranceManager.approveClaim(claimId);

    await expect(insuranceManager.settleClaim(claimId)).to.be.reverted;

    await insuranceManager.fundContract({ value: ethers.parseEther("1") });
    await expect(insuranceManager.settleClaim(claimId))
      .to.emit(insuranceManager, "ClaimSettled");
  });
});
