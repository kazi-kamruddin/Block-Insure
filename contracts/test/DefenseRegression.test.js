const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mine, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("InsuranceManager - Defense Regression Edges", function () {
  async function deployFixture() {
    const [admin, user, otherUser, oracle, auditor] = await ethers.getSigners();
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
    await insuranceManager.grantProjectRole(await insuranceManager.ORACLE_ROLE(), oracle.address);
    await insuranceManager.grantProjectRole(await insuranceManager.AUDITOR_ROLE(), auditor.address);
    await insuranceManager.updateQuorumThreshold(1);

    return { insuranceManager, admin, user, otherUser, oracle, auditor, premium };
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

  async function verifyClaim(insuranceManager, oracle, claimId, seed = "verified") {
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

    await insuranceManager.connect(oracle).submitOracleResult(
      event.args.requestId,
      true,
      ethers.keccak256(ethers.toUtf8Bytes(seed)),
      "LOW",
      "Verified"
    );

    return event.args.requestId;
  }

  async function failClaimOracle(insuranceManager, oracle, claimId, seed = "failed") {
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

    await insuranceManager.connect(oracle).submitOracleResult(
      event.args.requestId,
      false,
      ethers.keccak256(ethers.toUtf8Bytes(seed)),
      "HIGH",
      "Failed"
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
    const { insuranceManager, user, oracle, auditor, admin } = await deployFixture();
    const claimId = await submitClaim(insuranceManager, user, "appeal-vote-edge");

    await failClaimOracle(insuranceManager, oracle, claimId);
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
    const { insuranceManager, user, oracle } = await deployFixture();
    const claimId = await submitClaim(insuranceManager, user, "oracle-timeout-edge");
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

    await insuranceManager.updateOracleTimeoutBlocks(1);
    await mine(3);
    await insuranceManager.resolveTimedOutOracle(claimId);

    await expect(
      insuranceManager.connect(oracle).submitOracleResult(
        requestEvent.args.requestId,
        true,
        ethers.keccak256(ethers.toUtf8Bytes("late-result")),
        "LOW",
        "Late"
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
    const { insuranceManager, user, oracle, premium } = await deployFixture();
    const policy = await insuranceManager.getPolicy(1);

    await time.increaseTo(policy.nextPremiumDueDate - 1n);
    await insuranceManager.connect(user).payPremium(1, { value: premium });

    const claimId = await submitClaim(insuranceManager, user, "full-flow");
    await verifyClaim(insuranceManager, oracle, claimId, "full-flow-result");
    await insuranceManager.approveClaim(claimId);

    await expect(insuranceManager.settleClaim(claimId)).to.be.reverted;

    await insuranceManager.fundContract({ value: ethers.parseEther("1") });
    await expect(insuranceManager.settleClaim(claimId))
      .to.emit(insuranceManager, "ClaimSettled");
  });
});
