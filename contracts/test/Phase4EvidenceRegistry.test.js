const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Phase 4 - Evidence registry and root anchoring", function () {
  async function deployFixture() {
    const [admin, user, outsider] = await ethers.getSigners();
    const Manager = await ethers.getContractFactory("InsuranceManager");
    const manager = await Manager.deploy();
    const Registry = await ethers.getContractFactory("EvidenceRegistry");
    const registry = await Registry.deploy(await manager.getAddress());
    return { manager, registry, admin, user, outsider };
  }

  it("registers dedicated versioned encryption identities and supports revocation", async function () {
    const { registry, user } = await deployFixture();
    const publicKey = ethers.randomBytes(64);
    const signingKey = ethers.randomBytes(32);
    const scheme = ethers.keccak256(ethers.toUtf8Bytes("RECRYPT-RS-0.15"));
    await registry.connect(user).registerEncryptionIdentity(publicKey, signingKey, scheme);
    const identity = await registry.getEncryptionIdentity(user.address);
    expect(identity.version).to.equal(1);
    expect(identity.schemeVersion).to.equal(scheme);
    await registry.connect(user).revokeEncryptionIdentity();
    expect((await registry.getEncryptionIdentity(user.address)).revokedAt).to.be.greaterThan(0);
  });

  it("anchors only monotonic independently signed tree heads through an admin", async function () {
    const { registry, user, outsider } = await deployFixture();
    await registry.setTreeHeadSigner(user.address);
    const root1 = ethers.keccak256(ethers.toUtf8Bytes("root-1"));
    const digest1 = await registry.treeHeadDigest(1, root1, ethers.ZeroHash);
    const signature1 = await user.signMessage(ethers.getBytes(digest1));
    await expect(
      registry.connect(outsider).anchorEvidenceTreeHead(1, root1, ethers.ZeroHash, signature1)
    ).to.be.reverted;
    await registry.anchorEvidenceTreeHead(1, root1, ethers.ZeroHash, signature1);

    const root2 = ethers.keccak256(ethers.toUtf8Bytes("root-2"));
    const digest2 = await registry.treeHeadDigest(2, root2, root1);
    await expect(
      registry.anchorEvidenceTreeHead(
        2,
        root2,
        ethers.ZeroHash,
        await user.signMessage(ethers.getBytes(digest2))
      )
    ).to.be.reverted;
    await registry.anchorEvidenceTreeHead(
      2,
      root2,
      root1,
      await user.signMessage(ethers.getBytes(digest2))
    );
    expect(await registry.currentRootHash()).to.equal(root2);
    expect((await registry.getTreeHead(2)).signer).to.equal(user.address);
  });
});
