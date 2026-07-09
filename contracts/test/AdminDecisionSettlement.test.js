const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("InsuranceManager - Phase 9 Admin Decision and Settlement", function () {
  async function deployFixture() {
    const [admin, claimOfficer, oracle, user, attacker] = await ethers.getSigners();

    const InsuranceManager = await ethers.getContractFactory("InsuranceManager");
    const insuranceManager = await InsuranceManager.deploy();

    const CLAIM_OFFICER_ROLE = await insuranceManager.CLAIM_OFFICER_ROLE();
    const ORACLE_ROLE = await insuranceManager.ORACLE_ROLE();

    await insuranceManager.grantProjectRole(CLAIM_OFFICER_ROLE, claimOfficer.address);
    await insuranceManager.grantProjectRole(ORACLE_ROLE, oracle.address);
    await insuranceManager.updateQuorumThreshold(1);

    const PREMIUM = ethers.parseEther("0.01");
    const COVERAGE = ethers.parseEther("1");
    const CLAIM_AMOUNT = ethers.parseEther("0.2");

    await insuranceManager.createPolicyPackage(
      "Health Basic",
      "Health",
      PREMIUM,
      COVERAGE,
      365,
      "Hospital Bill"
    );

    await insuranceManager.connect(user).purchasePolicy(1, { value: PREMIUM });

    const policy = await insuranceManager.getPolicy(1);

    return {
      insuranceManager,
      admin,
      claimOfficer,
      oracle,
      user,
      attacker,
      PREMIUM,
      COVERAGE,
      CLAIM_AMOUNT,
      policy,
    };
  }

  function hashText(text) {
    return ethers.keccak256(ethers.toUtf8Bytes(text));
  }

  function getExpectedDefaultSettlement(claimAmount) {
    const deductibleRateBps = 1000n;
    const deductibleCapWei = ethers.parseEther("0.02");
    const insurerShareBps = 8000n;
    const rateDeductible = (claimAmount * deductibleRateBps) / 10000n;
    const deductible =
      rateDeductible < deductibleCapWei ? rateDeductible : deductibleCapWei;
    const afterDeductible = claimAmount - deductible;
    const insurerPays = (afterDeductible * insurerShareBps) / 10000n;
    const claimantResponsibility = claimAmount - insurerPays;

    return {
      claimAmount,
      deductible,
      afterDeductible,
      insurerPays,
      claimantResponsibility,
    };
  }

  async function submitCleanClaim({
    insuranceManager,
    user,
    policy,
    claimAmount,
    suffix,
    claimType = "Hospitalization",
  }) {
    const claimId = await insuranceManager.claimCounter();

    await insuranceManager.connect(user).submitClaim(
      1,
      claimAmount,
      policy.startDate,
      claimType,
      `HOSP-${suffix}`,
      hashText(`invoice-${suffix}`),
      hashText(`document-${suffix}`),
      `QmDocument${suffix}`
    );

    return claimId;
  }

  async function createOracleVerifiedClaim(fixture) {
    const { insuranceManager, oracle, user, policy, CLAIM_AMOUNT } = fixture;

    const claimId = await submitCleanClaim({
      insuranceManager,
      user,
      policy,
      claimAmount: CLAIM_AMOUNT,
      suffix: "verified",
    });

    await insuranceManager.requestOracleVerification(claimId);

    const oracleRequest = await insuranceManager.getOracleRequestByClaimId(claimId);

    await insuranceManager.connect(oracle).submitOracleResult(
      oracleRequest.requestId,
      true,
      hashText("verified-oracle-result"),
      "LOW",
      "Hospital record matched"
    );

    return claimId;
  }

  async function createOracleFailedClaim(fixture) {
    const { insuranceManager, oracle, user, policy, CLAIM_AMOUNT } = fixture;

    const claimId = await submitCleanClaim({
      insuranceManager,
      user,
      policy,
      claimAmount: CLAIM_AMOUNT,
      suffix: "failed",
    });

    await insuranceManager.requestOracleVerification(claimId);

    const oracleRequest = await insuranceManager.getOracleRequestByClaimId(claimId);

    await insuranceManager.connect(oracle).submitOracleResult(
      oracleRequest.requestId,
      false,
      hashText("failed-oracle-result"),
      "HIGH",
      "Invoice mismatch found"
    );

    return claimId;
  }

  async function createFraudFlaggedClaim(fixture) {
    const { insuranceManager, user, policy, CLAIM_AMOUNT } = fixture;

    const duplicateDocumentHash = hashText("phase9-duplicate-document");

    await insuranceManager.connect(user).submitClaim(
      1,
      CLAIM_AMOUNT,
      policy.startDate,
      "Hospitalization",
      "HOSP-FRAUD-1",
      hashText("phase9-invoice-1"),
      duplicateDocumentHash,
      "QmPhase9Document1"
    );

    const fraudClaimId = await insuranceManager.claimCounter();

    await insuranceManager.connect(user).submitClaim(
      1,
      CLAIM_AMOUNT,
      policy.startDate,
      "Surgery",
      "HOSP-FRAUD-2",
      hashText("phase9-invoice-2"),
      duplicateDocumentHash,
      "QmPhase9Document2"
    );

    return fraudClaimId;
  }

  it("Admin can approve an ORACLE_VERIFIED claim", async function () {
    const fixture = await deployFixture();
    const { insuranceManager, admin } = fixture;

    const claimId = await createOracleVerifiedClaim(fixture);

    await expect(insuranceManager.approveClaim(claimId))
      .to.emit(insuranceManager, "ClaimApproved")
      .withArgs(claimId, admin.address, anyValue);

    const claim = await insuranceManager.getClaim(claimId);
    expect(claim.status).to.equal(7); // APPROVED
  });

  it("Claim officer can approve an ORACLE_VERIFIED claim", async function () {
    const fixture = await deployFixture();
    const { insuranceManager, claimOfficer } = fixture;

    const claimId = await createOracleVerifiedClaim(fixture);

    await insuranceManager.connect(claimOfficer).approveClaim(claimId);

    const claim = await insuranceManager.getClaim(claimId);
    expect(claim.status).to.equal(7); // APPROVED
  });

  it("Non-admin and non-claim-officer cannot approve claim", async function () {
    const fixture = await deployFixture();
    const { insuranceManager, attacker } = fixture;

    const claimId = await createOracleVerifiedClaim(fixture);

    await expect(
      insuranceManager.connect(attacker).approveClaim(claimId)
    ).to.be.reverted;
  });

  it("Cannot approve ORACLE_FAILED claim directly", async function () {
    const fixture = await deployFixture();
    const { insuranceManager } = fixture;

    const claimId = await createOracleFailedClaim(fixture);

    await expect(
      insuranceManager.approveClaim(claimId)
    ).to.be.reverted;
  });

  it("Admin can reject a claim and store reason hash", async function () {
    const fixture = await deployFixture();
    const { insuranceManager, admin } = fixture;

    const claimId = await createOracleVerifiedClaim(fixture);
    const reasonHash = hashText("claim-rejected-for-test");

    await expect(insuranceManager.rejectClaim(claimId, reasonHash))
      .to.emit(insuranceManager, "ClaimRejected")
      .withArgs(claimId, admin.address, reasonHash);

    const claim = await insuranceManager.getClaim(claimId);
    expect(claim.status).to.equal(8); // REJECTED
  });

  it("Non-admin and non-claim-officer cannot reject claim", async function () {
    const fixture = await deployFixture();
    const { insuranceManager, attacker } = fixture;

    const claimId = await createOracleVerifiedClaim(fixture);

    await expect(
      insuranceManager.connect(attacker).rejectClaim(claimId, hashText("bad"))
    ).to.be.reverted;
  });

  it("Reject claim requires reason hash", async function () {
    const fixture = await deployFixture();
    const { insuranceManager } = fixture;

    const claimId = await createOracleVerifiedClaim(fixture);

    await expect(
      insuranceManager.rejectClaim(claimId, ethers.ZeroHash)
    ).to.be.reverted;
  });

  it("Admin can send ORACLE_FAILED claim to manual review", async function () {
    const fixture = await deployFixture();
    const { insuranceManager, admin } = fixture;

    const claimId = await createOracleFailedClaim(fixture);

    await expect(insuranceManager.sendToManualReview(claimId))
      .to.emit(insuranceManager, "ClaimSentToManualReview")
      .withArgs(claimId, admin.address, anyValue);

    const claim = await insuranceManager.getClaim(claimId);
    expect(claim.status).to.equal(6); // MANUAL_REVIEW
  });

  it("Admin can send FRAUD_FLAGGED claim to manual review", async function () {
    const fixture = await deployFixture();
    const { insuranceManager } = fixture;

    const claimId = await createFraudFlaggedClaim(fixture);

    await insuranceManager.sendToManualReview(claimId);

    const claim = await insuranceManager.getClaim(claimId);
    expect(claim.status).to.equal(6); // MANUAL_REVIEW
  });

  it("Cannot send ORACLE_VERIFIED claim to manual review", async function () {
    const fixture = await deployFixture();
    const { insuranceManager } = fixture;

    const claimId = await createOracleVerifiedClaim(fixture);

    await expect(
      insuranceManager.sendToManualReview(claimId)
    ).to.be.reverted;
  });

  it("Admin can settle approved claim with ETH transfer", async function () {
    const fixture = await deployFixture();
    const { insuranceManager, user, CLAIM_AMOUNT } = fixture;

    const claimId = await createOracleVerifiedClaim(fixture);
    const expectedSettlement = getExpectedDefaultSettlement(CLAIM_AMOUNT);

    await insuranceManager.approveClaim(claimId);
    await insuranceManager.fundContract({ value: CLAIM_AMOUNT });

    await expect(() => insuranceManager.settleClaim(claimId))
      .to.changeEtherBalances(
        [insuranceManager, user],
        [-expectedSettlement.insurerPays, expectedSettlement.insurerPays]
      );

    const claim = await insuranceManager.getClaim(claimId);
    expect(claim.status).to.equal(9); // SETTLED

    const settlement = await insuranceManager.getSettlementRecord(claimId);
    expect(settlement.claimId).to.equal(claimId);
    expect(settlement.recipient).to.equal(user.address);
    expect(settlement.amount).to.equal(expectedSettlement.insurerPays);
  });

  it("High-value settlement cannot bypass extra approval", async function () {
    const fixture = await deployFixture();
    const { insuranceManager, CLAIM_AMOUNT } = fixture;
    const highValueClaimAmount = CLAIM_AMOUNT * 2n;
    const claimId = await submitCleanClaim({
      ...fixture,
      claimAmount: highValueClaimAmount,
      suffix: "high-value-blocked",
    });

    await insuranceManager.requestOracleVerification(claimId);
    const oracleRequest = await insuranceManager.getOracleRequestByClaimId(claimId);
    await insuranceManager.connect(fixture.oracle).submitOracleResult(
      oracleRequest.requestId,
      true,
      hashText("high-value-blocked-oracle"),
      "LOW",
      "High-value claim verified"
    );
    await insuranceManager.approveClaim(claimId);
    await insuranceManager.fundContract({ value: highValueClaimAmount });

    await expect(insuranceManager.settleClaim(claimId)).to.be.reverted;
  });

  it("Admin can approve and settle a high-value claim", async function () {
    const fixture = await deployFixture();
    const { insuranceManager, user, CLAIM_AMOUNT } = fixture;
    const highValueClaimAmount = CLAIM_AMOUNT * 2n;
    const claimId = await submitCleanClaim({
      ...fixture,
      claimAmount: highValueClaimAmount,
      suffix: "high-value-approved",
    });
    const expectedSettlement = getExpectedDefaultSettlement(highValueClaimAmount);

    await insuranceManager.requestOracleVerification(claimId);
    const oracleRequest = await insuranceManager.getOracleRequestByClaimId(claimId);
    await insuranceManager.connect(fixture.oracle).submitOracleResult(
      oracleRequest.requestId,
      true,
      hashText("high-value-approved-oracle"),
      "LOW",
      "High-value claim verified"
    );
    await insuranceManager.approveClaim(claimId);
    await insuranceManager.fundContract({ value: highValueClaimAmount });

    await expect(insuranceManager.approveHighValueSettlement(claimId))
      .to.emit(insuranceManager, "HighValueSettlementApproved")
      .withArgs(
        claimId,
        fixture.admin.address,
        expectedSettlement.insurerPays,
        await insuranceManager.highValueSettlementThresholdWei(),
        anyValue
      );

    await expect(() => insuranceManager.settleClaim(claimId))
      .to.changeEtherBalances(
        [insuranceManager, user],
        [-expectedSettlement.insurerPays, expectedSettlement.insurerPays]
      );
  });

  it("Calculates default on-chain deductible and co-insurance settlement", async function () {
    const fixture = await deployFixture();
    const { insuranceManager, CLAIM_AMOUNT } = fixture;

    const claimId = await createOracleVerifiedClaim(fixture);
    const expectedSettlement = getExpectedDefaultSettlement(CLAIM_AMOUNT);

    const settlement = await insuranceManager.calculateSettlement(claimId);

    expect(settlement.claimAmount).to.equal(expectedSettlement.claimAmount);
    expect(settlement.deductible).to.equal(expectedSettlement.deductible);
    expect(settlement.afterDeductible).to.equal(expectedSettlement.afterDeductible);
    expect(settlement.insurerPays).to.equal(expectedSettlement.insurerPays);
    expect(settlement.claimantResponsibility).to.equal(
      expectedSettlement.claimantResponsibility
    );
  });

  it("Admin can update settlement parameters", async function () {
    const fixture = await deployFixture();
    const { insuranceManager, CLAIM_AMOUNT } = fixture;

    const claimId = await createOracleVerifiedClaim(fixture);
    const deductibleRateBps = 500n;
    const deductibleCapWei = ethers.parseEther("0.01");
    const insurerShareBps = 9000n;

    await expect(
      insuranceManager.updateSettlementParams(
        deductibleRateBps,
        deductibleCapWei,
        insurerShareBps
      )
    )
      .to.emit(insuranceManager, "SettlementParamsUpdated")
      .withArgs(deductibleRateBps, deductibleCapWei, insurerShareBps, anyValue);

    expect(await insuranceManager.deductibleRateBps()).to.equal(deductibleRateBps);
    expect(await insuranceManager.deductibleCapWei()).to.equal(deductibleCapWei);
    expect(await insuranceManager.insurerShareBps()).to.equal(insurerShareBps);

    const settlement = await insuranceManager.calculateSettlement(claimId);
    const expectedDeductible = (CLAIM_AMOUNT * 500n) / 10000n;
    const expectedInsurerPays =
      ((CLAIM_AMOUNT - expectedDeductible) * 9000n) / 10000n;

    expect(settlement.deductible).to.equal(expectedDeductible);
    expect(settlement.insurerPays).to.equal(expectedInsurerPays);
  });

  it("Rejects settlement parameters above 100 percent", async function () {
    const fixture = await deployFixture();
    const { insuranceManager } = fixture;

    await expect(
      insuranceManager.updateSettlementParams(10001, ethers.parseEther("0.02"), 8000)
    ).to.be.reverted;

    await expect(
      insuranceManager.updateSettlementParams(1000, ethers.parseEther("0.02"), 10001)
    ).to.be.reverted;
  });

  it("Claim officer cannot settle claim", async function () {
    const fixture = await deployFixture();
    const { insuranceManager, claimOfficer, CLAIM_AMOUNT } = fixture;

    const claimId = await createOracleVerifiedClaim(fixture);

    await insuranceManager.approveClaim(claimId);
    await insuranceManager.fundContract({ value: CLAIM_AMOUNT });

    await expect(
      insuranceManager.connect(claimOfficer).settleClaim(claimId)
    ).to.be.reverted;
  });

  it("Cannot settle claim before approval", async function () {
    const fixture = await deployFixture();
    const { insuranceManager, CLAIM_AMOUNT } = fixture;

    const claimId = await createOracleVerifiedClaim(fixture);

    await insuranceManager.fundContract({ value: CLAIM_AMOUNT });

    await expect(
      insuranceManager.settleClaim(claimId)
    ).to.be.reverted;
  });

  it("Cannot settle approved claim if contract balance is insufficient", async function () {
    const fixture = await deployFixture();
    const { insuranceManager } = fixture;

    const claimId = await createOracleVerifiedClaim(fixture);

    await insuranceManager.approveClaim(claimId);

    await expect(
      insuranceManager.settleClaim(claimId)
    ).to.be.reverted;
  });

  it("Rejects reading settlement record before settlement exists", async function () {
    const fixture = await deployFixture();
    const { insuranceManager } = fixture;

    const claimId = await createOracleVerifiedClaim(fixture);

    await expect(
      insuranceManager.getSettlementRecord(claimId)
    ).to.be.reverted;
  });

  it("Admin can fund contract using fundContract", async function () {
    const fixture = await deployFixture();
    const { insuranceManager, admin } = fixture;

    const amount = ethers.parseEther("0.5");
    const contractAddress = await insuranceManager.getAddress();
    const balanceBefore = await ethers.provider.getBalance(contractAddress);

    await expect(insuranceManager.fundContract({ value: amount }))
      .to.emit(insuranceManager, "ContractFunded")
      .withArgs(admin.address, amount);

    const balanceAfter = await ethers.provider.getBalance(contractAddress);

    expect(balanceAfter).to.equal(balanceBefore + amount);
  });

  it("Admin can withdraw excess ETH", async function () {
    const fixture = await deployFixture();
    const { insuranceManager, admin } = fixture;

    const fundAmount = ethers.parseEther("0.5");
    const withdrawAmount = ethers.parseEther("0.1");

    await insuranceManager.fundContract({ value: fundAmount });

    const contractAddress = await insuranceManager.getAddress();
    const balanceBefore = await ethers.provider.getBalance(contractAddress);

    await expect(insuranceManager.withdrawExcess(withdrawAmount))
      .to.emit(insuranceManager, "ExcessWithdrawn")
      .withArgs(admin.address, withdrawAmount);

    const balanceAfter = await ethers.provider.getBalance(contractAddress);

    expect(balanceAfter).to.equal(balanceBefore - withdrawAmount);
  });
});
