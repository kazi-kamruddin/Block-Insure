const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("InsuranceManager - Phase 2 Smoke Test", function () {
  async function deployFixture() {
    const [deployer, oracle, user] = await ethers.getSigners();

    const InsuranceManager = await ethers.getContractFactory("InsuranceManager");
    const insuranceManager = await InsuranceManager.deploy();

    return { insuranceManager, deployer, oracle, user };
  }

  it("Should deploy and give ADMIN_ROLE to deployer", async function () {
    const { insuranceManager, deployer } = await deployFixture();

    const ADMIN_ROLE = await insuranceManager.ADMIN_ROLE();

    expect(await insuranceManager.hasRole(ADMIN_ROLE, deployer.address)).to.equal(true);
  });

  it("Admin should grant ORACLE_ROLE to oracle account", async function () {
    const { insuranceManager, oracle } = await deployFixture();

    const ORACLE_ROLE = await insuranceManager.ORACLE_ROLE();

    await insuranceManager.grantProjectRole(ORACLE_ROLE, oracle.address);

    expect(await insuranceManager.hasRole(ORACLE_ROLE, oracle.address)).to.equal(true);
  });

  it("Non-admin should not grant roles", async function () {
    const { insuranceManager, oracle, user } = await deployFixture();

    const ORACLE_ROLE = await insuranceManager.ORACLE_ROLE();

    await expect(
      insuranceManager.connect(user).grantProjectRole(ORACLE_ROLE, oracle.address)
    ).to.be.reverted;
  });

  it("Admin should pause and unpause the contract", async function () {
    const { insuranceManager } = await deployFixture();

    await insuranceManager.pause();
    expect(await insuranceManager.paused()).to.equal(true);

    await insuranceManager.unpause();
    expect(await insuranceManager.paused()).to.equal(false);
  });
});