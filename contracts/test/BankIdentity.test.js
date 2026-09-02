const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BankIdentityRegistry", function () {
  async function deployFixture() {
    const [admin, bankWallet, otherWallet] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("BankIdentityRegistry", admin);
    const registry = await Registry.deploy(admin.address, admin.address);
    await registry.waitForDeployment();
    return { admin, bankWallet, otherWallet, registry };
  }

  it("registers one bank ID to an independently authorized wallet", async function () {
    const { bankWallet, registry } = await deployFixture();
    await expect(registry.registerBankIdentity("BANK-001", bankWallet.address))
      .to.emit(registry, "BankIdentityRegistered");
    const bankRole = await registry.BANK_ROLE();
    expect(await registry.hasRole(bankRole, bankWallet.address)).to.equal(true);
    expect(await registry.bankWalletByIdHash(ethers.id("BANK-001"))).to.equal(bankWallet.address);
  });

  it("prevents another wallet from taking an assigned bank ID", async function () {
    const { bankWallet, otherWallet, registry } = await deployFixture();
    await registry.registerBankIdentity("BANK-001", bankWallet.address);
    await expect(
      registry.registerBankIdentity("BANK-001", otherWallet.address)
    ).to.be.reverted;
  });

  it("anchors a replay-protected bank transfer as a policy premium", async function () {
    const [admin, bankWallet, policyholder] = await ethers.getSigners();
    const Manager = await ethers.getContractFactory("InsuranceManager", admin);
    const manager = await Manager.deploy();
    await manager.waitForDeployment();
    const Registry = await ethers.getContractFactory("BankIdentityRegistry", admin);
    const registry = await Registry.deploy(await manager.getAddress(), admin.address);
    await registry.waitForDeployment();
    await manager.configureBankPaymentRegistry(await registry.getAddress());
    await registry.registerBankIdentity("BANK-001", bankWallet.address);

    const premium = ethers.parseEther("0.01");
    await manager.createPolicyPackage("Quarterly Health", "HEALTH", premium, ethers.parseEther("1"), 365, "HOSPITAL_BILL");
    await manager.connect(policyholder).purchasePolicy(1, { value: premium });
    const transferReference = ethers.id("EFT-TXN-001");
    await expect(registry.connect(bankWallet).confirmEftTransfer(
      1, policyholder.address, premium, transferReference, ethers.id("EFT-MANDATE-001")
    )).to.emit(registry, "EftTransferConfirmed");

    const policy = await manager.getPolicy(1);
    expect(policy.installmentsPaid).to.equal(2n);
    expect(policy.premiumInterval).to.equal(90n * 24n * 60n * 60n);
    await expect(registry.connect(bankWallet).confirmEftTransfer(
      1, policyholder.address, premium, transferReference, ethers.id("EFT-MANDATE-001")
    )).to.be.reverted;
  });
});
