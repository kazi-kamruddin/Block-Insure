const { expect } = require("chai");
const { ethers } = require("hardhat");
const { configureOracleFixture } = require("./helpers/oracleCoordinator");

describe("InsuranceManager hospital verification boundary", function () {
  async function fixture() {
    const [admin, user, hospital, otherHospital, oracle1, oracle2] = await ethers.getSigners();
    const Manager = await ethers.getContractFactory("InsuranceManager");
    const manager = await Manager.deploy();
    const Registry = await ethers.getContractFactory("HospitalVerificationRegistry");
    const registry = await Registry.deploy(await manager.getAddress(), admin.address);
    const coordinator = await ethers.getContractAt(
      "OracleCoordinator",
      await manager.oracleCoordinator()
    );
    await coordinator.configureHospitalVerificationRegistry(await registry.getAddress());
    await configureOracleFixture(manager, admin, [oracle1, oracle2]);
    const premium = ethers.parseEther("0.01");
    await manager.createPolicyPackage(
      "Health Basic", "HEALTH", premium, ethers.parseEther("1"), 365, "HOSPITAL_BILL"
    );
    await manager.connect(user).purchasePolicy(1, { value: premium });
    await registry.registerHospitalIdentity("HOSP-001", hospital.address);
    const block = await ethers.provider.getBlock("latest");
    await manager.connect(user).submitClaim(
      1,
      ethers.parseEther("0.1"),
      block.timestamp,
      "HOSPITALIZATION",
      "HOSP-001",
      ethers.keccak256(ethers.toUtf8Bytes("INV-HOSP-001-001")),
      ethers.keccak256(ethers.toUtf8Bytes("DOC-HOSP-001-001")),
      "ipfs://hospital-claim"
    );
    return { manager, registry, admin, hospital, otherHospital };
  }

  it("registers a distinct hospital role and blocks insurer processing until it attests", async function () {
    const { manager, registry, hospital } = await fixture();
    const hospitalRole = await registry.HOSPITAL_ROLE();
    expect(await registry.hasRole(hospitalRole, hospital.address)).to.equal(true);
    await expect(manager.requestOracleVerification(1)).to.be.reverted;

    const attestationHash = ethers.keccak256(ethers.toUtf8Bytes("matching-record"));
    await expect(
      registry.connect(hospital).submitHospitalVerification(1, true, attestationHash)
    ).to.emit(registry, "HospitalClaimVerified");
    await expect(manager.requestOracleVerification(1)).to.emit(manager, "OracleRequested");
  });

  it("prevents a different hospital wallet from attesting the claim", async function () {
    const { registry, otherHospital } = await fixture();
    const hospitalRole = await registry.HOSPITAL_ROLE();
    await registry.grantRole(hospitalRole, otherHospital.address);
    await expect(
      registry.connect(otherHospital).submitHospitalVerification(
        1,
        true,
        ethers.keccak256(ethers.toUtf8Bytes("forged"))
      )
    ).to.be.reverted;
  });
});
