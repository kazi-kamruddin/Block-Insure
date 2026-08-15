const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("InsuranceManager - Premium Lifecycle", function () {
  const POLICY_STATUS = {
    PENDING_PAYMENT: 0,
    ACTIVE: 1,
    GRACE_PERIOD: 2,
    LAPSED: 3,
    CANCELLED: 4,
    EXPIRED: 5,
    RENEWED: 6,
  };

  async function deployFixture() {
    const [admin, user, otherUser] = await ethers.getSigners();

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

    return {
      insuranceManager,
      admin,
      user,
      otherUser,
      premium,
      coverage,
    };
  }

  async function submitValidClaim(insuranceManager, user, policyId, seed = "claim") {
    const policy = await insuranceManager.getPolicy(policyId);

    return insuranceManager.connect(user).submitClaim(
      policyId,
      ethers.parseEther("0.2"),
      policy.startDate,
      "Hospitalization",
      "HOSP-001",
      ethers.keccak256(ethers.toUtf8Bytes(`${seed}-invoice`)),
      ethers.keccak256(ethers.toUtf8Bytes(`${seed}-document`)),
      `Qm${seed}DocumentCid`
    );
  }

  it("purchase initializes recurring premium lifecycle fields", async function () {
    const { insuranceManager, user, premium } = await deployFixture();

    const policy = await insuranceManager.getPolicy(1);

    expect(policy.holderWallet).to.equal(user.address);
    expect(policy.status).to.equal(POLICY_STATUS.ACTIVE);
    expect(policy.premiumAmount).to.equal(premium);
    expect(policy.premiumInterval).to.equal(30n * 24n * 60n * 60n);
    expect(policy.lastPaidTimestamp).to.equal(policy.startDate);
    expect(policy.totalPremiumPaid).to.equal(premium);
    expect(policy.premiumPaid).to.equal(premium);
    expect(policy.installmentsPaid).to.equal(1);
    expect(policy.nextPremiumDueDate).to.equal(
      policy.startDate + policy.premiumInterval
    );
    expect(policy.gracePeriodEnd).to.equal(
      policy.nextPremiumDueDate + 7n * 24n * 60n * 60n
    );
    expect(await insuranceManager.getEffectivePolicyStatus(1)).to.equal(
      POLICY_STATUS.ACTIVE
    );
  });

  it("payPremium advances due date and totals", async function () {
    const { insuranceManager, user, premium } = await deployFixture();

    const beforePayment = await insuranceManager.getPolicy(1);
    await time.increaseTo(beforePayment.nextPremiumDueDate - 1n);

    await expect(
      insuranceManager.connect(user).payPremium(1, { value: premium })
    )
      .to.emit(insuranceManager, "PremiumPaid")
      .withArgs(1, user.address, premium, anyValue, anyValue, 2, premium * 2n);

    const afterPayment = await insuranceManager.getPolicy(1);

    expect(afterPayment.installmentsPaid).to.equal(2);
    expect(afterPayment.totalPremiumPaid).to.equal(premium * 2n);
    expect(afterPayment.premiumPaid).to.equal(premium * 2n);
    expect(afterPayment.nextPremiumDueDate).to.be.greaterThan(
      beforePayment.nextPremiumDueDate
    );
    expect(afterPayment.status).to.equal(POLICY_STATUS.ACTIVE);
  });

  it("allows claims only while the effective policy status is ACTIVE", async function () {
    const { insuranceManager, user } = await deployFixture();

    await expect(submitValidClaim(insuranceManager, user, 1, "active"))
      .to.emit(insuranceManager, "ClaimSubmitted");
  });

  it("keeps prior covered incidents claimable but excludes grace and lapse incidents", async function () {
    const { insuranceManager, user } = await deployFixture();

    const policy = await insuranceManager.getPolicy(1);

    await time.increaseTo(policy.nextPremiumDueDate + 1n);

    expect(await insuranceManager.getEffectivePolicyStatus(1)).to.equal(
      POLICY_STATUS.GRACE_PERIOD
    );

    await expect(submitValidClaim(insuranceManager, user, 1, "grace-covered"))
      .to.emit(insuranceManager, "ClaimSubmitted");

    await expect(
      insuranceManager.connect(user).submitClaim(
        1,
        ethers.parseEther("0.2"),
        policy.nextPremiumDueDate + 1n,
        "Surgery",
        "HOSP-001",
        ethers.keccak256(ethers.toUtf8Bytes("grace-gap-invoice")),
        ethers.keccak256(ethers.toUtf8Bytes("grace-gap-document")),
        "QmGraceGapDocument"
      )
    ).to.be.reverted;

    await time.increaseTo(policy.gracePeriodEnd + 1n);

    expect(await insuranceManager.getEffectivePolicyStatus(1)).to.equal(
      POLICY_STATUS.LAPSED
    );

    await expect(
      insuranceManager.connect(user).submitClaim(
        1,
        ethers.parseEther("0.2"),
        policy.nextPremiumDueDate + 2n,
        "Accident Treatment",
        "HOSP-001",
        ethers.keccak256(ethers.toUtf8Bytes("lapsed-gap-invoice")),
        ethers.keccak256(ethers.toUtf8Bytes("lapsed-gap-document")),
        "QmLapsedGapDocument"
      )
    ).to.be.reverted;
  });

  it("keeps covered incidents claimable after cancellation or expiry", async function () {
    const { insuranceManager, user, premium } = await deployFixture();

    await insuranceManager.connect(user).purchasePolicy(1, { value: premium });
    await insuranceManager.connect(user).cancelPolicy(1);

    expect(await insuranceManager.getEffectivePolicyStatus(1)).to.equal(
      POLICY_STATUS.CANCELLED
    );

    await expect(submitValidClaim(insuranceManager, user, 1, "cancelled-covered"))
      .to.emit(insuranceManager, "ClaimSubmitted");

    const cancelledAt = BigInt(await time.latest());
    await expect(
      insuranceManager.connect(user).submitClaim(
        1,
        ethers.parseEther("0.2"),
        cancelledAt + 1n,
        "Hospitalization",
        "HOSP-001",
        ethers.keccak256(ethers.toUtf8Bytes("cancelled-late-invoice")),
        ethers.keccak256(ethers.toUtf8Bytes("cancelled-late-document")),
        "QmCancelledLate"
      )
    ).to.be.reverted;

    const secondPolicy = await insuranceManager.getPolicy(2);

    await time.increaseTo(secondPolicy.endDate + 1n);

    expect(await insuranceManager.getEffectivePolicyStatus(2)).to.equal(
      POLICY_STATUS.EXPIRED
    );

    await expect(
      insuranceManager.connect(user).submitClaim(
        2,
        ethers.parseEther("0.2"),
        secondPolicy.nextPremiumDueDate - 1n,
        "Hospitalization",
        "HOSP-001",
        ethers.keccak256(ethers.toUtf8Bytes("expired-covered-invoice")),
        ethers.keccak256(ethers.toUtf8Bytes("expired-covered-document")),
        "QmExpiredCovered"
      )
    ).to.emit(insuranceManager, "ClaimSubmitted");
  });

  it("does not allow an expired policy to be relabeled as cancelled", async function () {
    const { insuranceManager, user } = await deployFixture();
    const policy = await insuranceManager.getPolicy(1);

    await time.increaseTo(policy.endDate + 1n);

    await expect(insuranceManager.connect(user).cancelPolicy(1)).to.be.reverted;
    expect(await insuranceManager.getEffectivePolicyStatus(1)).to.equal(
      POLICY_STATUS.EXPIRED
    );
  });

  it("requires lapsed policies to use reinstatement instead of payPremium", async function () {
    const { insuranceManager, user, premium } = await deployFixture();

    const policy = await insuranceManager.getPolicy(1);

    await time.increaseTo(policy.gracePeriodEnd + 1n);

    await expect(
      insuranceManager.connect(user).payPremium(1, { value: premium })
    ).to.be.reverted;

    await expect(
      insuranceManager.connect(user).reinstatePolicy(1, { value: premium })
    )
      .to.emit(insuranceManager, "PremiumPaid")
      .withArgs(1, user.address, premium, anyValue, anyValue, 2, premium * 2n);

    const reinstatedPolicy = await insuranceManager.getPolicy(1);

    expect(reinstatedPolicy.status).to.equal(POLICY_STATUS.ACTIVE);
    expect(reinstatedPolicy.installmentsPaid).to.equal(2);

    await expect(submitValidClaim(insuranceManager, user, 1, "reinstated"))
      .to.emit(insuranceManager, "ClaimSubmitted");
  });

  it("rejects premium payments from non-holders and with incorrect amounts", async function () {
    const { insuranceManager, user, otherUser, premium } = await deployFixture();

    await expect(
      insuranceManager.connect(otherUser).payPremium(1, { value: premium })
    ).to.be.reverted;

    await expect(
      insuranceManager.connect(user).payPremium(1, { value: premium / 2n })
    ).to.be.reverted;
  });
});
