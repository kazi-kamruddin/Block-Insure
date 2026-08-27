const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Phase 5 - versioned deployment and migration preparation", function () {
  it("records versioned components without an upgrade implementation switch", async function () {
    const [admin, outsider] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("ProtocolDeploymentRegistry");
    const manifestHash = ethers.id("migration-manifest-v1");
    const registry = await Registry.deploy(ethers.id("BLOCK_INSURE_V1"), manifestHash);
    await registry.registerComponent(
      ethers.id("InsuranceManager"),
      outsider.address,
      ethers.id("IInsuranceManager/1"),
      true
    );
    const component = await registry.getComponent(ethers.id("InsuranceManager"));
    expect(component.deployment).to.equal(outsider.address);
    expect(component.interfaceVersion).to.equal(ethers.id("IInsuranceManager/1"));
    expect(await registry.migrationManifestHash()).to.equal(manifestHash);
    await expect(
      registry.connect(outsider).commitMigrationManifest(ethers.id("attacker"))
    ).to.be.reverted;
  });
});
