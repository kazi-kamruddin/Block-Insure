const { expect } = require("chai");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { ethers } = require("hardhat");

describe("InsuranceManager - Claim Appeal Workflow", function () {
  async function deployFixture() {
    const [admin, claimant, otherUser, oracle] = await ethers.getSigners();

    const InsuranceManager = await ethers.getContractFactory("InsuranceManager");
    const insuranceManager = await InsuranceManager.deploy();
    const ORACLE_ROLE = await insuranceManager.ORACLE_ROLE();

    await insuranceManager.grantProjectRole(ORACLE_ROLE, oracle.address);

    await insuranceManager.createPolicyPackage(
      "Health Basic",
      "HEALTH",
      ethers.parseEther("0.01"),
      ethers.parseEther("1"),
      365,
      "HOSPITAL_BILL"
    );

    await insuranceManager
      .connect(claimant)
      .purchasePolicy(1, { value: ethers.parseEther("0.01") });

    const latestBlock = await ethers.provider.getBlock("latest");
    const incidentDate = latestBlock.timestamp;

    await insuranceManager.connect(claimant).submitClaim(
      1,
      ethers.parseEther("0.1"),
      incidentDate,
      "HOSPITALIZATION",
      "HOSP-001",
      ethers.keccak256(ethers.toUtf8Bytes("appeal-invoice")),
      ethers.keccak256(ethers.toUtf8Bytes("appeal-document")),
      "ipfs://appeal-document"
    );

    return { insuranceManager, admin, claimant, otherUser, oracle };
  }

  it("Claimant can appeal a rejected claim once", async function () {
    const { insuranceManager, claimant } = await deployFixture();
    const appealReasonHash = "0xappeal-reason-sha256";
    const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("Rejected by admin"));

    await insuranceManager.rejectClaim(1, reasonHash);

    await expect(
      insuranceManager.connect(claimant).submitAppeal(1, appealReasonHash)
    )
      .to.emit(insuranceManager, "ClaimAppealed")
      .withArgs(1, claimant.address, appealReasonHash, anyValue);

    expect(await insuranceManager.claimAppealed(1)).to.equal(true);

    await expect(
      insuranceManager.connect(claimant).submitAppeal(1, appealReasonHash)
    ).to.be.reverted;
  });

  it("Rejects appeals from non-claimants or non-rejected claims", async function () {
    const { insuranceManager, claimant, otherUser } = await deployFixture();
    const appealReasonHash = "0xappeal-reason-sha256";

    await expect(
      insuranceManager.connect(claimant).submitAppeal(1, appealReasonHash)
    ).to.be.reverted;

    await insuranceManager.rejectClaim(
      1,
      ethers.keccak256(ethers.toUtf8Bytes("Rejected by admin"))
    );

    await expect(
      insuranceManager.connect(otherUser).submitAppeal(1, appealReasonHash)
    ).to.be.reverted;
  });

  it("Requires a non-empty appeal reason hash", async function () {
    const { insuranceManager, claimant } = await deployFixture();

    await insuranceManager.rejectClaim(
      1,
      ethers.keccak256(ethers.toUtf8Bytes("Rejected by admin"))
    );

    await expect(
      insuranceManager.connect(claimant).submitAppeal(1, "")
    ).to.be.reverted;
  });

  it("Admin can reopen an appealed claim for a fresh oracle cycle", async function () {
    const { insuranceManager, admin, claimant, oracle } = await deployFixture();
    const rejectionReason = ethers.keccak256(
      ethers.toUtf8Bytes("Rejected after first oracle cycle")
    );

    await insuranceManager.updateQuorumThreshold(1);
    await insuranceManager.requestOracleVerification(1);
    await insuranceManager.connect(oracle).submitOracleResult(
      1,
      true,
      ethers.keccak256(ethers.toUtf8Bytes("appeal-oracle-result")),
      "LOW",
      "Initial oracle verification passed"
    );

    expect((await insuranceManager.getClaim(1)).riskScore).to.equal(100);

    await insuranceManager.rejectClaim(1, rejectionReason);
    await insuranceManager
      .connect(claimant)
      .submitAppeal(1, "0xappeal-reason-sha256");

    await expect(insuranceManager.reopenClaimAfterAppeal(1))
      .to.emit(insuranceManager, "ClaimReopenedAfterAppeal")
      .withArgs(1, admin.address, anyValue);

    const reopenedClaim = await insuranceManager.getClaim(1);

    expect(reopenedClaim.status).to.equal(1); // DUPLICATE_CHECKED
    expect(reopenedClaim.riskScore).to.equal(90);
    expect(await insuranceManager.claimAppealed(1)).to.equal(true);

    await insuranceManager.requestOracleVerification(1);

    const replacementRequest = await insuranceManager.getOracleRequestByClaimId(1);
    expect(replacementRequest.requestId).to.equal(2);

    await insuranceManager.rejectClaim(1, rejectionReason);

    await expect(
      insuranceManager
        .connect(claimant)
        .submitAppeal(1, "0xsecond-appeal-reason")
    ).to.be.reverted;
  });

  it("Only an admin can reopen a rejected appealed claim", async function () {
    const { insuranceManager, claimant, otherUser } = await deployFixture();

    await insuranceManager.rejectClaim(
      1,
      ethers.keccak256(ethers.toUtf8Bytes("Rejected by admin"))
    );
    await insuranceManager
      .connect(claimant)
      .submitAppeal(1, "0xappeal-reason-sha256");

    await expect(
      insuranceManager.connect(otherUser).reopenClaimAfterAppeal(1)
    ).to.be.reverted;
  });
});
