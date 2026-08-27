const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const {
  getOracleCoordinator,
} = require("./helpers/oracleCoordinator");

describe("OracleCoordinator - Versioned Registry Commitments", function () {
  async function deployFixture() {
    const [admin, nonAdmin] = await ethers.getSigners();
    const InsuranceManager = await ethers.getContractFactory("InsuranceManager");
    const insuranceManager = await InsuranceManager.deploy();
    const coordinator = await getOracleCoordinator(insuranceManager);
    return { insuranceManager, coordinator, admin, nonAdmin };
  }

  it("publishes immutable, versioned registry snapshots", async function () {
    const { insuranceManager, coordinator } = await deployFixture();
    const rootV1 = ethers.keccak256(ethers.toUtf8Bytes("registry-root-v1"));
    const rootV2 = ethers.keccak256(ethers.toUtf8Bytes("registry-root-v2"));
    const schemaV1 = ethers.keccak256(ethers.toUtf8Bytes("schema-v1"));
    const schemaV2 = ethers.keccak256(ethers.toUtf8Bytes("schema-v2"));

    await expect(coordinator.publishRegistrySnapshot(rootV1, 20, schemaV1))
      .to.emit(coordinator, "RegistrySnapshotPublished")
      .withArgs(1, rootV1, schemaV1, 20, anyValue, anyValue);
    await coordinator.publishRegistrySnapshot(rootV2, 25, schemaV2);

    const first = await coordinator.getRegistrySnapshot(1);
    const second = await coordinator.getRegistrySnapshot(2);
    expect(first.root).to.equal(rootV1);
    expect(first.treeVersionHash).to.equal(schemaV1);
    expect(first.leafCount).to.equal(20);
    expect(second.root).to.equal(rootV2);
    expect(await coordinator.currentRegistryRoot()).to.equal(rootV2);
    expect(await coordinator.currentRegistryVersion()).to.equal(2);
    expect(await coordinator.manager()).to.equal(await insuranceManager.getAddress());
  });

  it("allows manager admins but rejects non-admin publishers", async function () {
    const { coordinator, nonAdmin } = await deployFixture();
    const root = ethers.keccak256(ethers.toUtf8Bytes("registry-root-v1"));
    const schema = ethers.keccak256(ethers.toUtf8Bytes("schema-v1"));

    await expect(
      coordinator.connect(nonAdmin).publishRegistrySnapshot(root, 1, schema)
    ).to.be.reverted;
  });

  it("rejects empty commitments and unknown versions", async function () {
    const { coordinator } = await deployFixture();
    const root = ethers.keccak256(ethers.toUtf8Bytes("registry-root-v1"));
    const schema = ethers.keccak256(ethers.toUtf8Bytes("schema-v1"));

    await expect(
      coordinator.publishRegistrySnapshot(ethers.ZeroHash, 1, schema)
    ).to.be.reverted;
    await expect(
      coordinator.publishRegistrySnapshot(root, 1, ethers.ZeroHash)
    ).to.be.reverted;
    await expect(
      coordinator.publishRegistrySnapshot(root, 0, schema)
    ).to.be.reverted;
    await expect(coordinator.getRegistrySnapshot(1)).to.be.reverted;
  });
});
