const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  configureOracleFixture,
  finalizeExactResult,
} = require("./helpers/oracleCoordinator");

function getRiskLevel(claim) {
  if (Number(claim.status) === 2) return "FRAUD_FLAGGED";
  if (Number(claim.status) === 5) return "ORACLE_FAILED";
  if (Number(claim.riskScore) >= 80) return "LOW";
  if (Number(claim.riskScore) >= 50) return "MEDIUM";
  return "HIGH";
}

describe("InsuranceManager - Phase 7 Risk Score Logic", function () {
  async function deployFixture() {
    const [admin, user, oracle, secondOracle] = await ethers.getSigners();

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
      oracle,
      secondOracle,
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
    expect((await insuranceManager.getClaim(1)).riskScore).to.equal(90);
  });

  it("Clean claim risk level is LOW", async function () {
    const { insuranceManager, user, policy } = await deployFixture();

    await submitClaim({ insuranceManager, user, policy });

    expect(getRiskLevel(await insuranceManager.getClaim(1))).to.equal("LOW");
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
    expect(getRiskLevel(await insuranceManager.getClaim(2))).to.equal(
      "FRAUD_FLAGGED"
    );
  });

  it("Rejects risk score and risk level lookup for non-existing claim", async function () {
    const { insuranceManager } = await deployFixture();

    await expect(insuranceManager.getClaim(999)).to.be.reverted;
  });

  it("Oracle-failed claim risk level returns ORACLE_FAILED", async function () {
    const { insuranceManager, user, policy, admin, oracle, secondOracle } = await deployFixture();
    const coordinator = await configureOracleFixture(
      insuranceManager,
      admin,
      [oracle, secondOracle]
    );

    await submitClaim({ insuranceManager, user, policy });

    await insuranceManager.requestOracleVerification(1);

    await finalizeExactResult(
      coordinator,
      1,
      [oracle, secondOracle],
      false,
      hashText("failed-oracle-risk-response")
    );

    const claim = await insuranceManager.getClaim(1);

    expect(claim.status).to.equal(5); // ORACLE_FAILED
    expect(claim.riskScore).to.equal(90);
    expect(getRiskLevel(await insuranceManager.getClaim(1))).to.equal(
      "ORACLE_FAILED"
    );
  });
});
