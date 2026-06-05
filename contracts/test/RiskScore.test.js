const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("InsuranceManager - Phase 7 Risk Score Logic", function () {
  async function deployFixture() {
    const [admin, user] = await ethers.getSigners();

    const InsuranceManager = await ethers.getContractFactory("InsuranceManager");
    const insuranceManager = await InsuranceManager.deploy();

    const PREMIUM = ethers.parseEther("0.01");
    const COVERAGE = ethers.parseEther("1");

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
      user,
      PREMIUM,
      COVERAGE,
      policy,
    };
  }

  function hashText(text) {
    return ethers.keccak256(ethers.toUtf8Bytes(text));
  }

  async function submitClaim({
    insuranceManager,
    user,
    policy,
    claimType = "Hospitalization",
    invoiceText = "invoice-risk-001",
    documentText = "document-risk-001",
    documentCID = "QmRiskDocument001",
  }) {
    return insuranceManager.connect(user).submitClaim(
      1,
      ethers.parseEther("0.2"),
      policy.startDate,
      claimType,
      "HOSP-001",
      hashText(invoiceText),
      hashText(documentText),
      documentCID
    );
  }

  it("Clean claim receives risk score of 90", async function () {
    const { insuranceManager, user, policy } = await deployFixture();

    await submitClaim({ insuranceManager, user, policy });

    const claim = await insuranceManager.getClaim(1);

    expect(claim.riskScore).to.equal(90);
    expect(await insuranceManager.getRiskScore(1)).to.equal(90);
  });

  it("Clean claim risk level is LOW", async function () {
    const { insuranceManager, user, policy } = await deployFixture();

    await submitClaim({ insuranceManager, user, policy });

    expect(await insuranceManager.getRiskLevel(1)).to.equal("LOW");
  });

  it("Fraud-flagged claim risk level returns FRAUD_FLAGGED", async function () {
    const { insuranceManager, user, policy } = await deployFixture();

    const duplicateDocumentHash = hashText("duplicate-risk-document");

    await insuranceManager.connect(user).submitClaim(
      1,
      ethers.parseEther("0.2"),
      policy.startDate,
      "Hospitalization",
      "HOSP-001",
      hashText("risk-invoice-001"),
      duplicateDocumentHash,
      "QmRiskDocument001"
    );

    await insuranceManager.connect(user).submitClaim(
      1,
      ethers.parseEther("0.2"),
      policy.startDate,
      "Surgery",
      "HOSP-001",
      hashText("risk-invoice-002"),
      duplicateDocumentHash,
      "QmRiskDocumentDuplicate"
    );

    const fraudClaim = await insuranceManager.getClaim(2);

    expect(fraudClaim.status).to.equal(2); // FRAUD_FLAGGED
    expect(await insuranceManager.getRiskLevel(2)).to.equal("FRAUD_FLAGGED");
  });

  it("Rejects risk score and risk level lookup for non-existing claim", async function () {
    const { insuranceManager } = await deployFixture();

    await expect(insuranceManager.getRiskScore(999))
      .to.be.revertedWith("Claim does not exist");

    await expect(insuranceManager.getRiskLevel(999))
      .to.be.revertedWith("Claim does not exist");
  });

  it("Oracle-failed claim risk level returns ORACLE_FAILED", async function () {
    const { insuranceManager, user, policy, admin } = await deployFixture();
  
    const ORACLE_ROLE = await insuranceManager.ORACLE_ROLE();

    await insuranceManager.grantProjectRole(ORACLE_ROLE, admin.address);
    await insuranceManager.updateQuorumThreshold(1);

    await submitClaim({ insuranceManager, user, policy });

    await insuranceManager.requestOracleVerification(1);

    await insuranceManager.submitOracleResult(
      1,
      false,
      hashText("failed-oracle-risk-response"),
      "HIGH",
      "Oracle verification failed"
    );

    const claim = await insuranceManager.getClaim(1);

    expect(claim.status).to.equal(5); // ORACLE_FAILED
    expect(claim.riskScore).to.equal(90);
    expect(await insuranceManager.getRiskLevel(1)).to.equal("ORACLE_FAILED");
  });
});
