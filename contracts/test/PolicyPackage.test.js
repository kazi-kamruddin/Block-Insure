const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("InsuranceManager - Phase 3 Policy Package System", function () {
  async function deployFixture() {
    const [admin, nonAdmin] = await ethers.getSigners();

    const InsuranceManager = await ethers.getContractFactory("InsuranceManager");
    const insuranceManager = await InsuranceManager.deploy();

    return { insuranceManager, admin, nonAdmin };
  }

  const PACKAGE_NAME = "Health Basic";
  const POLICY_TYPE = "Health";
  const PREMIUM = ethers.parseEther("0.01");
  const COVERAGE = ethers.parseEther("1");
  const DURATION_DAYS = 365;
  const REQUIRED_DOCUMENT = "Hospital Bill";

  it("Admin can create a policy package", async function () {
    const { insuranceManager } = await deployFixture();

    await expect(
      insuranceManager.createPolicyPackage(
        PACKAGE_NAME,
        POLICY_TYPE,
        PREMIUM,
        COVERAGE,
        DURATION_DAYS,
        REQUIRED_DOCUMENT
      )
    )
      .to.emit(insuranceManager, "PolicyPackageCreated")
      .withArgs(1, PACKAGE_NAME, PREMIUM, COVERAGE);

    const policyPackage = await insuranceManager.getPolicyPackage(1);

    expect(policyPackage.packageId).to.equal(1);
    expect(policyPackage.name).to.equal(PACKAGE_NAME);
    expect(policyPackage.policyType).to.equal(POLICY_TYPE);
    expect(policyPackage.premiumAmount).to.equal(PREMIUM);
    expect(policyPackage.coverageAmount).to.equal(COVERAGE);
    expect(policyPackage.durationDays).to.equal(DURATION_DAYS);
    expect(policyPackage.requiredDocumentType).to.equal(REQUIRED_DOCUMENT);
    expect(policyPackage.isActive).to.equal(true);
  });

  it("Non-admin cannot create a policy package", async function () {
    const { insuranceManager, nonAdmin } = await deployFixture();

    await expect(
      insuranceManager.connect(nonAdmin).createPolicyPackage(
        PACKAGE_NAME,
        POLICY_TYPE,
        PREMIUM,
        COVERAGE,
        DURATION_DAYS,
        REQUIRED_DOCUMENT
      )
    ).to.be.reverted;
  });

  it("Cannot create a package with invalid values", async function () {
    const { insuranceManager } = await deployFixture();

    await expect(
      insuranceManager.createPolicyPackage(
        "",
        POLICY_TYPE,
        PREMIUM,
        COVERAGE,
        DURATION_DAYS,
        REQUIRED_DOCUMENT
      )
    ).to.be.reverted;

    await expect(
      insuranceManager.createPolicyPackage(
        PACKAGE_NAME,
        "",
        PREMIUM,
        COVERAGE,
        DURATION_DAYS,
        REQUIRED_DOCUMENT
      )
    ).to.be.reverted;

    await expect(
      insuranceManager.createPolicyPackage(
        PACKAGE_NAME,
        POLICY_TYPE,
        0,
        COVERAGE,
        DURATION_DAYS,
        REQUIRED_DOCUMENT
      )
    ).to.be.reverted;

    await expect(
      insuranceManager.createPolicyPackage(
        PACKAGE_NAME,
        POLICY_TYPE,
        PREMIUM,
        0,
        DURATION_DAYS,
        REQUIRED_DOCUMENT
      )
    ).to.be.reverted;

    await expect(
      insuranceManager.createPolicyPackage(
        PACKAGE_NAME,
        POLICY_TYPE,
        PREMIUM,
        COVERAGE,
        0,
        REQUIRED_DOCUMENT
      )
    ).to.be.reverted;

    await expect(
      insuranceManager.createPolicyPackage(
        PACKAGE_NAME,
        POLICY_TYPE,
        PREMIUM,
        COVERAGE,
        DURATION_DAYS,
        ""
      )
    ).to.be.reverted;
  });

  it("Admin can update a policy package", async function () {
    const { insuranceManager } = await deployFixture();

    await insuranceManager.createPolicyPackage(
      PACKAGE_NAME,
      POLICY_TYPE,
      PREMIUM,
      COVERAGE,
      DURATION_DAYS,
      REQUIRED_DOCUMENT
    );

    const updatedPremium = ethers.parseEther("0.02");
    const updatedCoverage = ethers.parseEther("2");

    await expect(
      insuranceManager.updatePolicyPackage(
        1,
        "Health Premium",
        "Health",
        updatedPremium,
        updatedCoverage,
        730,
        "Hospital Bill and Doctor Certificate"
      )
    )
      .to.emit(insuranceManager, "PolicyPackageUpdated")
      .withArgs(1, "Health Premium", updatedPremium, updatedCoverage, 730);

    const policyPackage = await insuranceManager.getPolicyPackage(1);

    expect(policyPackage.name).to.equal("Health Premium");
    expect(policyPackage.premiumAmount).to.equal(updatedPremium);
    expect(policyPackage.coverageAmount).to.equal(updatedCoverage);
    expect(policyPackage.durationDays).to.equal(730);
    expect(policyPackage.requiredDocumentType).to.equal("Hospital Bill and Doctor Certificate");
  });

  it("Admin can deactivate and reactivate a policy package", async function () {
    const { insuranceManager } = await deployFixture();

    await insuranceManager.createPolicyPackage(
      PACKAGE_NAME,
      POLICY_TYPE,
      PREMIUM,
      COVERAGE,
      DURATION_DAYS,
      REQUIRED_DOCUMENT
    );

    await expect(insuranceManager.deactivatePolicyPackage(1))
      .to.emit(insuranceManager, "PolicyPackageDeactivated")
      .withArgs(1);

    let policyPackage = await insuranceManager.getPolicyPackage(1);
    expect(policyPackage.isActive).to.equal(false);

    await expect(insuranceManager.reactivatePolicyPackage(1))
      .to.emit(insuranceManager, "PolicyPackageReactivated")
      .withArgs(1);

    policyPackage = await insuranceManager.getPolicyPackage(1);
    expect(policyPackage.isActive).to.equal(true);
  });

  it("Can return all package IDs and active package IDs", async function () {
    const { insuranceManager } = await deployFixture();

    await insuranceManager.createPolicyPackage(
      "Health Basic",
      "Health",
      ethers.parseEther("0.01"),
      ethers.parseEther("1"),
      365,
      "Hospital Bill"
    );

    await insuranceManager.createPolicyPackage(
      "Vehicle Basic",
      "Vehicle",
      ethers.parseEther("0.02"),
      ethers.parseEther("2"),
      365,
      "Police Report"
    );

    await insuranceManager.deactivatePolicyPackage(2);

    const allIds = await insuranceManager.getAllPackageIds();
    expect(allIds.map((id) => Number(id))).to.deep.equal([1, 2]);

    const activeIds = await insuranceManager.getActivePackageIds();
    expect(activeIds.map((id) => Number(id))).to.deep.equal([1]);
  });

  it("Cannot read, update, deactivate, or reactivate a non-existing package", async function () {
    const { insuranceManager } = await deployFixture();

    await expect(insuranceManager.getPolicyPackage(999))
      .to.be.reverted;

    await expect(
      insuranceManager.updatePolicyPackage(
        999,
        PACKAGE_NAME,
        POLICY_TYPE,
        PREMIUM,
        COVERAGE,
        DURATION_DAYS,
        REQUIRED_DOCUMENT
      )
    ).to.be.reverted;

    await expect(insuranceManager.deactivatePolicyPackage(999))
      .to.be.reverted;

    await expect(insuranceManager.reactivatePolicyPackage(999))
      .to.be.reverted;
  });
});