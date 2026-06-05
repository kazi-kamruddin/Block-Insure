const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("InsuranceManager - Registry Merkle Root Commitment", function () {
  async function deployFixture() {
    const [admin, nonAdmin] = await ethers.getSigners();

    const InsuranceManager = await ethers.getContractFactory("InsuranceManager");
    const insuranceManager = await InsuranceManager.deploy();

    return { insuranceManager, admin, nonAdmin };
  }

  it("Admin can update and read the registry Merkle snapshot", async function () {
    const { insuranceManager, admin } = await deployFixture();
    const root = ethers.keccak256(ethers.toUtf8Bytes("registry-root-v1"));

    const tx = await insuranceManager.updateRegistryMerkleRoot(root);
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt.blockNumber);

    await expect(tx)
      .to.emit(insuranceManager, "RegistryRootUpdated")
      .withArgs(root, block.timestamp, receipt.blockNumber, admin.address);

    const snapshot = {
      root: await insuranceManager.registryMerkleRoot(),
      timestamp: await insuranceManager.registrySnapshotTimestamp(),
      blockNumber: await insuranceManager.registrySnapshotBlock(),
    };

    expect(snapshot.root).to.equal(root);
    expect(snapshot.timestamp).to.equal(block.timestamp);
    expect(snapshot.blockNumber).to.equal(receipt.blockNumber);
  });

  it("Non-admin cannot update the registry Merkle root", async function () {
    const { insuranceManager, nonAdmin } = await deployFixture();
    const root = ethers.keccak256(ethers.toUtf8Bytes("registry-root-v1"));

    await expect(
      insuranceManager.connect(nonAdmin).updateRegistryMerkleRoot(root)
    ).to.be.reverted;
  });
});
