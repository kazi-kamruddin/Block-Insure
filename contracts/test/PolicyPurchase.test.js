const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("InsuranceManager - Phase 4 Policy Purchase System", function () {
  async function deployFixture() {
    const [admin, user, otherUser] = await ethers.getSigners();

    const InsuranceManager = await ethers.getContractFactory("InsuranceManager");
    const insuranceManager = await InsuranceManager.deploy();

    const PACKAGE_NAME = "Health Basic";
    const POLICY_TYPE = "Health";
    const PREMIUM = ethers.parseEther("0.01");
    const COVERAGE = ethers.parseEther("1");
    const DURATION_DAYS = 365;
    const REQUIRED_DOCUMENT = "Hospital Bill";

    await insuranceManager.createPolicyPackage(
      PACKAGE_NAME,
      POLICY_TYPE,
      PREMIUM,
      COVERAGE,
      DURATION_DAYS,
      REQUIRED_DOCUMENT
    );

    return {
      insuranceManager,
      admin,
      user,
      otherUser,
      PACKAGE_NAME,
      POLICY_TYPE,
      PREMIUM,
      COVERAGE,
      DURATION_DAYS,
      REQUIRED_DOCUMENT,
    };
  }

  it("User can purchase an active policy package with exact premium", async function () {
    const { insuranceManager, user, PREMIUM, COVERAGE } = await deployFixture();

    await expect(
      insuranceManager.connect(user).purchasePolicy(1, { value: PREMIUM })
    )
      .to.emit(insuranceManager, "PolicyPurchased")
      .withArgs(1, 1, user.address, COVERAGE, anyValue);

    const policy = await insuranceManager.getPolicy(1);

    expect(policy.policyId).to.equal(1);
    expect(policy.packageId).to.equal(1);
    expect(policy.holderWallet).to.equal(user.address);
    expect(policy.coverageAmount).to.equal(COVERAGE);
    expect(policy.premiumPaid).to.equal(PREMIUM);
    expect(policy.isActive).to.equal(true);

    expect(await insuranceManager.isPolicyActive(1)).to.equal(true);
  });

  it("Stores purchased policy ID under the user's wallet", async function () {
    const { insuranceManager, user, PREMIUM } = await deployFixture();

    await insuranceManager.connect(user).purchasePolicy(1, { value: PREMIUM });

    const userPolicyIds = await insuranceManager.getPoliciesByWallet(user.address);

    expect(userPolicyIds.map((id) => Number(id))).to.deep.equal([1]);
  });

  it("Increases contract balance after policy purchase", async function () {
    const { insuranceManager, user, PREMIUM } = await deployFixture();

    await insuranceManager.connect(user).purchasePolicy(1, { value: PREMIUM });

    const contractBalance = await insuranceManager.getContractBalance();

    expect(contractBalance).to.equal(PREMIUM);
  });

  it("Rejects purchase with incorrect premium amount", async function () {
    const { insuranceManager, user } = await deployFixture();

    const wrongPremium = ethers.parseEther("0.005");

    await expect(
      insuranceManager.connect(user).purchasePolicy(1, { value: wrongPremium })
    ).to.be.revertedWith("Incorrect premium amount");
  });

  it("Rejects purchase of non-existing package", async function () {
    const { insuranceManager, user, PREMIUM } = await deployFixture();

    await expect(
      insuranceManager.connect(user).purchasePolicy(999, { value: PREMIUM })
    ).to.be.revertedWith("Package does not exist");
  });

  it("Rejects purchase of inactive package", async function () {
    const { insuranceManager, user, PREMIUM } = await deployFixture();

    await insuranceManager.deactivatePolicyPackage(1);

    await expect(
      insuranceManager.connect(user).purchasePolicy(1, { value: PREMIUM })
    ).to.be.revertedWith("Package is not active");
  });

  it("Creates multiple policies for the same user", async function () {
    const { insuranceManager, user, PREMIUM } = await deployFixture();

    await insuranceManager.connect(user).purchasePolicy(1, { value: PREMIUM });
    await insuranceManager.connect(user).purchasePolicy(1, { value: PREMIUM });

    const userPolicyIds = await insuranceManager.getPoliciesByWallet(user.address);

    expect(userPolicyIds.map((id) => Number(id))).to.deep.equal([1, 2]);

    const firstPolicy = await insuranceManager.getPolicy(1);
    const secondPolicy = await insuranceManager.getPolicy(2);

    expect(firstPolicy.holderWallet).to.equal(user.address);
    expect(secondPolicy.holderWallet).to.equal(user.address);
  });

  it("Creates separate policy records for different users", async function () {
    const { insuranceManager, user, otherUser, PREMIUM } = await deployFixture();

    await insuranceManager.connect(user).purchasePolicy(1, { value: PREMIUM });
    await insuranceManager.connect(otherUser).purchasePolicy(1, { value: PREMIUM });

    const userPolicyIds = await insuranceManager.getPoliciesByWallet(user.address);
    const otherUserPolicyIds = await insuranceManager.getPoliciesByWallet(otherUser.address);

    expect(userPolicyIds.map((id) => Number(id))).to.deep.equal([1]);
    expect(otherUserPolicyIds.map((id) => Number(id))).to.deep.equal([2]);
  });

  it("Returns false for expired policy using isPolicyActive", async function () {
    const { insuranceManager, user, PREMIUM } = await deployFixture();

    await insuranceManager.connect(user).purchasePolicy(1, { value: PREMIUM });

    expect(await insuranceManager.isPolicyActive(1)).to.equal(true);

    await time.increase(366 * 24 * 60 * 60);

    expect(await insuranceManager.isPolicyActive(1)).to.equal(false);
  });

  it("Rejects reading non-existing policy", async function () {
    const { insuranceManager } = await deployFixture();

    await expect(insuranceManager.getPolicy(999))
      .to.be.revertedWith("Policy does not exist");

    await expect(insuranceManager.isPolicyActive(999))
      .to.be.revertedWith("Policy does not exist");
  });

  it("Purchase policy is blocked when contract is paused", async function () {
    const { insuranceManager, user, PREMIUM } = await deployFixture();

    await insuranceManager.pause();

    await expect(
      insuranceManager.connect(user).purchasePolicy(1, { value: PREMIUM })
    ).to.be.reverted;
  });

  it("Contract can receive direct ETH through receive function", async function () {
    const { insuranceManager, admin } = await deployFixture();

    const amount = ethers.parseEther("0.05");

    await admin.sendTransaction({
      to: await insuranceManager.getAddress(),
      value: amount,
    });

    expect(await insuranceManager.getContractBalance()).to.equal(amount);
  });
});