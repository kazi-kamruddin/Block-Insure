const { expect } = require("chai");
const { ethers } = require("hardhat");
const { getActiveRoleMembers } = require("./helpers/contractQueries");
const {
  configureOracleFixture,
  finalizeExactResult,
} = require("./helpers/oracleCoordinator");

describe("InsuranceManager - Phase 2 Smoke Test", function () {
  async function deployFixture() {
    const [
      deployer,
      oracle,
      user,
      secondAdmin,
      auditor,
      secondAuditor,
      secondOracle,
    ] = await ethers.getSigners();

    const InsuranceManager = await ethers.getContractFactory("InsuranceManager");
    const insuranceManager = await InsuranceManager.deploy();

    return {
      insuranceManager,
      deployer,
      oracle,
      user,
      secondAdmin,
      auditor,
      secondAuditor,
      secondOracle,
    };
  }

  async function createOracleFailedClaim(insuranceManager, deployer, oracle, secondOracle, user) {
    const premiumAmount = ethers.parseEther("0.01");
    const coverageAmount = ethers.parseEther("1");

    await insuranceManager.createPolicyPackage(
      "Health Basic",
      "HEALTH",
      premiumAmount,
      coverageAmount,
      365,
      "HOSPITAL_BILL"
    );

    await insuranceManager.connect(user).purchasePolicy(1, {
      value: premiumAmount,
    });

    const latestBlock = await ethers.provider.getBlock("latest");
    const claimAmount = ethers.parseEther("0.1");

    await insuranceManager.connect(user).submitClaim(
      1,
      claimAmount,
      latestBlock.timestamp,
      "SURGERY",
      "HOSP-1",
      ethers.keccak256(ethers.toUtf8Bytes("INV-1")),
      ethers.keccak256(ethers.toUtf8Bytes("DOC-1")),
      "ipfs://claim-document"
    );

    const coordinator = await configureOracleFixture(
      insuranceManager,
      deployer,
      [oracle, secondOracle]
    );
    await insuranceManager.connect(deployer).requestOracleVerification(1);

    await finalizeExactResult(
      coordinator,
      1,
      [oracle, secondOracle],
      false,
      ethers.keccak256(ethers.toUtf8Bytes("oracle-result"))
    );

    return 1;
  }

  it("Should deploy and give ADMIN_ROLE to deployer", async function () {
    const { insuranceManager, deployer } = await deployFixture();

    const ADMIN_ROLE = await insuranceManager.ADMIN_ROLE();

    expect(await insuranceManager.hasRole(ADMIN_ROLE, deployer.address)).to.equal(true);
  });

  it("Admin should grant ORACLE_ROLE to oracle account through project wrapper", async function () {
    const { insuranceManager, oracle } = await deployFixture();

    const ORACLE_ROLE = await insuranceManager.ORACLE_ROLE();

    await insuranceManager.grantProjectRole(ORACLE_ROLE, oracle.address);

    expect(await insuranceManager.hasRole(ORACLE_ROLE, oracle.address)).to.equal(true);
  });

  it("Admin should track active auditor role holders", async function () {
    const { insuranceManager, auditor } = await deployFixture();

    const AUDITOR_ROLE = await insuranceManager.AUDITOR_ROLE();

    await insuranceManager.grantProjectRole(AUDITOR_ROLE, auditor.address);

    expect(
      await getActiveRoleMembers(insuranceManager, AUDITOR_ROLE)
    ).to.deep.equal([auditor.address.toLowerCase()]);

    await insuranceManager.revokeProjectRole(AUDITOR_ROLE, auditor.address);

    expect(
      await getActiveRoleMembers(insuranceManager, AUDITOR_ROLE)
    ).to.deep.equal([]);
  });

  it("Admin should grant ORACLE_ROLE through inherited grantRole override", async function () {
    const { insuranceManager, oracle } = await deployFixture();

    const ORACLE_ROLE = await insuranceManager.ORACLE_ROLE();

    await insuranceManager.grantRole(ORACLE_ROLE, oracle.address);

    expect(await insuranceManager.hasRole(ORACLE_ROLE, oracle.address)).to.equal(true);
  });

  it("Newly granted admin can grant ORACLE_ROLE", async function () {
    const { insuranceManager, deployer, oracle, user } = await deployFixture();

    const ADMIN_ROLE = await insuranceManager.ADMIN_ROLE();
    const ORACLE_ROLE = await insuranceManager.ORACLE_ROLE();

    await insuranceManager.connect(deployer).grantProjectRole(ADMIN_ROLE, user.address);

    await insuranceManager.connect(user).grantProjectRole(ORACLE_ROLE, oracle.address);

    expect(await insuranceManager.hasRole(ORACLE_ROLE, oracle.address)).to.equal(true);
  });

  it("Non-admin should not grant roles", async function () {
    const { insuranceManager, oracle, user } = await deployFixture();

    const ORACLE_ROLE = await insuranceManager.ORACLE_ROLE();

    await expect(
      insuranceManager.connect(user).grantProjectRole(ORACLE_ROLE, oracle.address)
    ).to.be.reverted;

    await expect(
      insuranceManager.connect(user).grantRole(ORACLE_ROLE, oracle.address)
    ).to.be.reverted;
  });

  it("Admin should not grant DEFAULT_ADMIN_ROLE through project role wrapper", async function () {
    const { insuranceManager, user } = await deployFixture();

    const DEFAULT_ADMIN_ROLE = await insuranceManager.DEFAULT_ADMIN_ROLE();

    await expect(
      insuranceManager.grantProjectRole(DEFAULT_ADMIN_ROLE, user.address)
    ).to.be.reverted;
  });

  it("Admin should not grant DEFAULT_ADMIN_ROLE through inherited grantRole override", async function () {
    const { insuranceManager, user } = await deployFixture();

    const DEFAULT_ADMIN_ROLE = await insuranceManager.DEFAULT_ADMIN_ROLE();

    await expect(
      insuranceManager.grantRole(DEFAULT_ADMIN_ROLE, user.address)
    ).to.be.reverted;
  });

  it("Admin should not revoke DEFAULT_ADMIN_ROLE through project role wrapper", async function () {
    const { insuranceManager, deployer } = await deployFixture();

    const DEFAULT_ADMIN_ROLE = await insuranceManager.DEFAULT_ADMIN_ROLE();

    await expect(
      insuranceManager.revokeProjectRole(DEFAULT_ADMIN_ROLE, deployer.address)
    ).to.be.reverted;
  });

  it("Admin should not revoke DEFAULT_ADMIN_ROLE through inherited revokeRole override", async function () {
    const { insuranceManager, deployer } = await deployFixture();

    const DEFAULT_ADMIN_ROLE = await insuranceManager.DEFAULT_ADMIN_ROLE();

    await expect(
      insuranceManager.revokeRole(DEFAULT_ADMIN_ROLE, deployer.address)
    ).to.be.reverted;
  });

  it("Admin should not renounce DEFAULT_ADMIN_ROLE", async function () {
    const { insuranceManager, deployer } = await deployFixture();

    const DEFAULT_ADMIN_ROLE = await insuranceManager.DEFAULT_ADMIN_ROLE();

    await expect(
      insuranceManager.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address)
    ).to.be.reverted;
  });

  it("Admin should not revoke the final ADMIN_ROLE holder through project wrapper", async function () {
    const { insuranceManager, deployer } = await deployFixture();

    const ADMIN_ROLE = await insuranceManager.ADMIN_ROLE();

    await expect(
      insuranceManager.revokeProjectRole(ADMIN_ROLE, deployer.address)
    ).to.be.reverted;
  });

  it("Admin should not revoke the final ADMIN_ROLE holder through inherited revokeRole override", async function () {
    const { insuranceManager, deployer } = await deployFixture();

    const ADMIN_ROLE = await insuranceManager.ADMIN_ROLE();

    await expect(
      insuranceManager.revokeRole(ADMIN_ROLE, deployer.address)
    ).to.be.reverted;
  });

  it("Admin should not renounce the final ADMIN_ROLE holder", async function () {
    const { insuranceManager, deployer } = await deployFixture();

    const ADMIN_ROLE = await insuranceManager.ADMIN_ROLE();

    await expect(
      insuranceManager.renounceRole(ADMIN_ROLE, deployer.address)
    ).to.be.reverted;
  });

  it("Admin can revoke ADMIN_ROLE when another admin remains through project wrapper", async function () {
    const { insuranceManager, deployer, secondAdmin } = await deployFixture();

    const ADMIN_ROLE = await insuranceManager.ADMIN_ROLE();

    await insuranceManager.grantProjectRole(ADMIN_ROLE, secondAdmin.address);

    expect(await insuranceManager.hasRole(ADMIN_ROLE, secondAdmin.address)).to.equal(true);

    await insuranceManager.revokeProjectRole(ADMIN_ROLE, deployer.address);

    expect(await insuranceManager.hasRole(ADMIN_ROLE, deployer.address)).to.equal(false);
    expect(await insuranceManager.hasRole(ADMIN_ROLE, secondAdmin.address)).to.equal(true);
  });

  it("Admin can revoke ADMIN_ROLE when another admin remains through inherited revokeRole override", async function () {
    const { insuranceManager, deployer, secondAdmin } = await deployFixture();

    const ADMIN_ROLE = await insuranceManager.ADMIN_ROLE();

    await insuranceManager.grantRole(ADMIN_ROLE, secondAdmin.address);

    expect(await insuranceManager.hasRole(ADMIN_ROLE, secondAdmin.address)).to.equal(true);

    await insuranceManager.revokeRole(ADMIN_ROLE, deployer.address);

    expect(await insuranceManager.hasRole(ADMIN_ROLE, deployer.address)).to.equal(false);
    expect(await insuranceManager.hasRole(ADMIN_ROLE, secondAdmin.address)).to.equal(true);
  });

  it("Admin can renounce ADMIN_ROLE when another admin remains", async function () {
    const { insuranceManager, deployer, secondAdmin } = await deployFixture();

    const ADMIN_ROLE = await insuranceManager.ADMIN_ROLE();

    await insuranceManager.grantProjectRole(ADMIN_ROLE, secondAdmin.address);

    await insuranceManager.renounceRole(ADMIN_ROLE, deployer.address);

    expect(await insuranceManager.hasRole(ADMIN_ROLE, deployer.address)).to.equal(false);
    expect(await insuranceManager.hasRole(ADMIN_ROLE, secondAdmin.address)).to.equal(true);
  });

  it("Admin should pause and unpause the contract", async function () {
    const { insuranceManager } = await deployFixture();

    await insuranceManager.pause();
    expect(await insuranceManager.paused()).to.equal(true);

    await insuranceManager.unpause();
    expect(await insuranceManager.paused()).to.equal(false);
  });

  it("Auditor voting should require a reviewable claim status and valid vote", async function () {
    const { insuranceManager, deployer, oracle, secondOracle, user, auditor } = await deployFixture();
    const AUDITOR_ROLE = await insuranceManager.AUDITOR_ROLE();
    const premiumAmount = ethers.parseEther("0.01");
    const coverageAmount = ethers.parseEther("1");

    await insuranceManager.grantProjectRole(AUDITOR_ROLE, auditor.address);
    await insuranceManager.createPolicyPackage(
      "Health Basic",
      "HEALTH",
      premiumAmount,
      coverageAmount,
      365,
      "HOSPITAL_BILL"
    );
    await insuranceManager.connect(user).purchasePolicy(1, {
      value: premiumAmount,
    });

    const latestBlock = await ethers.provider.getBlock("latest");

    await insuranceManager.connect(user).submitClaim(
      1,
      ethers.parseEther("0.1"),
      latestBlock.timestamp,
      "SURGERY",
      "HOSP-1",
      ethers.keccak256(ethers.toUtf8Bytes("INV-2")),
      ethers.keccak256(ethers.toUtf8Bytes("DOC-2")),
      "ipfs://claim-document-2"
    );

    await expect(
      insuranceManager.connect(auditor).castVote(1, await insuranceManager.VOTE_VALID())
    ).to.be.reverted;

    await configureOracleFixture(
      insuranceManager,
      deployer,
      [oracle, secondOracle]
    );
    await insuranceManager.requestOracleVerification(1);

    await expect(
      insuranceManager.connect(auditor).castVote(1, 9)
    ).to.be.reverted;
  });
});
