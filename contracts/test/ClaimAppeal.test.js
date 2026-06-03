const { expect } = require("chai");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { ethers } = require("hardhat");

describe("InsuranceManager - Claim Appeal Workflow", function () {
  async function deployFixture() {
    const [admin, claimant, otherUser] = await ethers.getSigners();

    const InsuranceManager = await ethers.getContractFactory("InsuranceManager");
    const insuranceManager = await InsuranceManager.deploy();

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

    return { insuranceManager, admin, claimant, otherUser };
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
    ).to.be.revertedWith("Claim already appealed");
  });

  it("Rejects appeals from non-claimants or non-rejected claims", async function () {
    const { insuranceManager, claimant, otherUser } = await deployFixture();
    const appealReasonHash = "0xappeal-reason-sha256";

    await expect(
      insuranceManager.connect(claimant).submitAppeal(1, appealReasonHash)
    ).to.be.revertedWith("Claim is not rejected");

    await insuranceManager.rejectClaim(
      1,
      ethers.keccak256(ethers.toUtf8Bytes("Rejected by admin"))
    );

    await expect(
      insuranceManager.connect(otherUser).submitAppeal(1, appealReasonHash)
    ).to.be.revertedWith("Caller is not claimant");
  });

  it("Requires a non-empty appeal reason hash", async function () {
    const { insuranceManager, claimant } = await deployFixture();

    await insuranceManager.rejectClaim(
      1,
      ethers.keccak256(ethers.toUtf8Bytes("Rejected by admin"))
    );

    await expect(
      insuranceManager.connect(claimant).submitAppeal(1, "")
    ).to.be.revertedWith("Appeal reason hash required");
  });
});
