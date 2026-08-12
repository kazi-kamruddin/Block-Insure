const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("PolicyBenefitsManager - Phase 2 benefits", function () {
  async function deployFixture() {
    const [admin, holder, beneficiaryOne, beneficiaryTwo, outsider] =
      await ethers.getSigners();
    const InsuranceManager = await ethers.getContractFactory("InsuranceManager");
    const insurance = await InsuranceManager.deploy();
    const premium = ethers.parseEther("0.01");
    const coverage = ethers.parseEther("1");
    await insurance.createPolicyPackage(
      "Family Protection",
      "HEALTH_AND_LIFE",
      premium,
      coverage,
      365,
      "HOSPITAL_BILL"
    );
    await insurance.connect(holder).purchasePolicy(1, { value: premium });

    const Benefits = await ethers.getContractFactory("PolicyBenefitsManager");
    const benefits = await Benefits.deploy(await insurance.getAddress(), admin.address);
    const termsHash = ethers.keccak256(ethers.toUtf8Bytes("family-protection-v1"));
    await benefits.publishBenefitTerms(
      1,
      true,
      true,
      true,
      10000,
      5000,
      500,
      1,
      1,
      termsHash
    );
    await admin.sendTransaction({
      to: await benefits.getAddress(),
      value: ethers.parseEther("3"),
    });

    return {
      admin,
      holder,
      beneficiaryOne,
      beneficiaryTwo,
      outsider,
      insurance,
      benefits,
      premium,
      coverage,
      termsHash,
    };
  }

  it("publishes only increasing, hashed benefit-term versions", async function () {
    const { benefits, outsider, termsHash } = await deployFixture();
    await expect(
      benefits.connect(outsider).publishBenefitTerms(
        1, true, true, true, 10000, 5000, 500, 1, 2, termsHash
      )
    ).to.be.reverted;
    await expect(
      benefits.publishBenefitTerms(
        1, true, true, true, 10000, 5000, 500, 1, 1, termsHash
      )
    ).to.be.reverted;
  });

  it("lets only the holder register one to three beneficiaries totaling 100 percent", async function () {
    const { benefits, holder, beneficiaryOne, beneficiaryTwo, outsider } =
      await deployFixture();
    await expect(
      benefits.connect(outsider).setBeneficiaries(1, [beneficiaryOne.address], [10000])
    ).to.be.reverted;
    await expect(
      benefits.connect(holder).setBeneficiaries(
        1,
        [beneficiaryOne.address, beneficiaryTwo.address],
        [5000, 4000]
      )
    ).to.be.reverted;

    await benefits.connect(holder).setBeneficiaries(
      1,
      [beneficiaryOne.address, beneficiaryTwo.address],
      [6000, 4000]
    );
    const beneficiaries = await benefits.getBeneficiaries(1);
    expect(beneficiaries).to.have.length(2);
    expect(beneficiaries[0].shareBps).to.equal(6000);
  });

  it("requires a registered beneficiary and evidence for a death request", async function () {
    const { benefits, holder, beneficiaryOne, outsider, coverage } = await deployFixture();
    await benefits.connect(holder).setBeneficiaries(1, [beneficiaryOne.address], [10000]);
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("death-certificate"));

    await expect(
      benefits.connect(outsider).requestBenefit(1, 0, evidenceHash)
    ).to.be.reverted;
    await expect(
      benefits.connect(beneficiaryOne).requestBenefit(1, 0, ethers.ZeroHash)
    ).to.be.reverted;
    await expect(benefits.connect(beneficiaryOne).requestBenefit(1, 0, evidenceHash))
      .to.emit(benefits, "BenefitRequested")
      .withArgs(1, 1, 0, coverage, beneficiaryOne.address);
    await expect(
      benefits.connect(holder).setBeneficiaries(1, [outsider.address], [10000])
    ).to.be.reverted;
  });

  it("reserves and distributes an approved death benefit by registered shares", async function () {
    const { benefits, holder, beneficiaryOne, beneficiaryTwo, coverage } =
      await deployFixture();
    await benefits.connect(holder).setBeneficiaries(
      1,
      [beneficiaryOne.address, beneficiaryTwo.address],
      [6000, 4000]
    );
    await benefits.connect(beneficiaryOne).requestBenefit(
      1,
      0,
      ethers.keccak256(ethers.toUtf8Bytes("verified-death-record"))
    );
    await benefits.approveBenefit(1);
    expect(await benefits.totalReservedLiabilityWei()).to.equal(coverage);

    await expect(() => benefits.settleBenefit(1)).to.changeEtherBalances(
      [beneficiaryOne, beneficiaryTwo, benefits],
      [ethers.parseEther("0.6"), ethers.parseEther("0.4"), -coverage]
    );
    expect((await benefits.getBenefitRequest(1)).status).to.equal(4);
    expect(await benefits.totalReservedLiabilityWei()).to.equal(0);
  });

  it("requires cancellation and minimum installments before surrender", async function () {
    const { benefits, holder, insurance, premium } = await deployFixture();
    await expect(
      benefits.connect(holder).requestBenefit(1, 1, ethers.ZeroHash)
    ).to.be.reverted;
    await insurance.connect(holder).cancelPolicy(1);
    await benefits.connect(holder).requestBenefit(1, 1, ethers.ZeroHash);
    expect((await benefits.getBenefitRequest(1)).amount).to.equal(premium / 2n);
  });

  it("requires expiry before maturity and applies the published bonus", async function () {
    const { benefits, holder, insurance, premium } = await deployFixture();
    await expect(
      benefits.connect(holder).requestBenefit(1, 2, ethers.ZeroHash)
    ).to.be.reverted;
    const policy = await insurance.getPolicy(1);
    await time.increaseTo(policy.endDate + 1n);
    await benefits.connect(holder).requestBenefit(1, 2, ethers.ZeroHash);
    expect((await benefits.getBenefitRequest(1)).amount).to.equal(
      (premium * 10500n) / 10000n
    );
  });

  it("does not allow withdrawal of an approved benefit liability", async function () {
    const { benefits, holder, beneficiaryOne, admin } = await deployFixture();
    await benefits.connect(holder).setBeneficiaries(1, [beneficiaryOne.address], [10000]);
    await benefits.connect(beneficiaryOne).requestBenefit(
      1,
      0,
      ethers.keccak256(ethers.toUtf8Bytes("death-evidence"))
    );
    await benefits.approveBenefit(1);
    await expect(
      benefits.withdrawExcess(admin.address, ethers.parseEther("2.1"))
    ).to.be.reverted;
  });

  it("allows corrected evidence to be resubmitted after rejection", async function () {
    const { benefits, holder, beneficiaryOne } = await deployFixture();
    await benefits.connect(holder).setBeneficiaries(1, [beneficiaryOne.address], [10000]);
    await benefits.connect(beneficiaryOne).requestBenefit(
      1,
      0,
      ethers.keccak256(ethers.toUtf8Bytes("incomplete-evidence"))
    );
    await benefits.rejectBenefit(
      1,
      ethers.keccak256(ethers.toUtf8Bytes("evidence incomplete"))
    );
    await benefits.connect(holder).setBeneficiaries(1, [beneficiaryOne.address], [10000]);
    await benefits.connect(beneficiaryOne).requestBenefit(
      1,
      0,
      ethers.keccak256(ethers.toUtf8Bytes("corrected-evidence"))
    );
    expect(await benefits.requestByPolicyAndType(1, 0)).to.equal(2);
  });
});
