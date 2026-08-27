const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  configureOracleFixture,
  finalizeExactResult,
} = require("./helpers/oracleCoordinator");

describe("Phase 3 - Policy economics and Solidity rules", function () {
  const hash = (value) => ethers.keccak256(ethers.toUtf8Bytes(value));
  const premium = ethers.parseEther("0.01");
  const coverage = ethers.parseEther("1");

  async function deployFixture({ configuredRules } = {}) {
    const [admin, user, other, oracle1, oracle2] = await ethers.getSigners();
    const Manager = await ethers.getContractFactory("InsuranceManager");
    const manager = await Manager.deploy();
    const Adjudicator = await ethers.getContractFactory("ClaimAdjudicator");
    const adjudicator = await Adjudicator.deploy(await manager.getAddress());
    await manager.configureClaimAdjudicator(await adjudicator.getAddress());
    const economics = await ethers.getContractAt(
      "PolicyEconomics",
      await manager.policyEconomics()
    );

    await manager.createPolicyPackage(
      "Health Basic",
      "HEALTH",
      premium,
      coverage,
      365,
      "HOSPITAL_BILL"
    );
    if (configuredRules) {
      await publishRules(economics, 1, configuredRules);
    }
    await manager.connect(user).purchasePolicy(1, { value: premium });
    return { manager, adjudicator, economics, admin, user, other, oracle1, oracle2 };
  }

  async function publishRules(economics, version, overrides = {}) {
    const surgery = hash("SURGERY");
    const rules = {
      version,
      waitingPeriod: 0,
      reinstatementWaitingPeriod: 0,
      claimDeadline: 365 * 24 * 60 * 60,
      minimumDocumentCommitments: 1,
      deductibleRateBps: 1000,
      insurerShareBps: 8000,
      deductibleCapWei: ethers.parseEther("0.02"),
      maximumClaimWei: coverage,
      exclusionsRoot: hash(`exclusions-${version}`),
      requiredDocumentsRoot: hash(`documents-${version}`),
      settlementFormulaVersion: hash(`formula-${version}`),
      policyRuleVersion: hash(`policy-rules-${version}`),
      ...overrides,
    };
    await economics.publishPackageRules(
      1,
      rules,
      overrides.allowedServices || [surgery],
      overrides.excludedServices || []
    );
  }

  async function submit(manager, user, suffix, amount = ethers.parseEther("0.2"), incidentDate) {
    const policy = await manager.getPolicy(1);
    return manager.connect(user).submitClaim(
      1,
      amount,
      incidentDate ?? policy.startDate,
      "SURGERY",
      "HOSP-001",
      hash(`invoice-${suffix}`),
      hash(`document-${suffix}`),
      `ipfs://document-${suffix}`
    );
  }

  async function approve(manager, fixture, claimId) {
    const coordinator = await configureOracleFixture(
      manager,
      fixture.admin,
      [fixture.oracle1, fixture.oracle2]
    );
    await manager.requestOracleVerification(claimId);
    const request = await coordinator.getRequestByClaimId(claimId);
    await finalizeExactResult(
      coordinator,
      request.requestId,
      [fixture.oracle1, fixture.oracle2],
      true,
      hash(`result-${claimId}`)
    );
  }

  it("prevents cumulative reservations from exceeding policy coverage", async function () {
    const fixture = await deployFixture();
    await submit(fixture.manager, fixture.user, "one", ethers.parseEther("0.7"));
    await expect(
      submit(fixture.manager, fixture.user, "two", ethers.parseEther("0.7"))
    ).to.be.reverted;

    const account = await fixture.economics.getCoverageAccount(1);
    expect(account.reservedCoverageWei + account.settledCoverageWei).to.be.lte(
      account.coverageLimitWei
    );
  });

  it("moves reserved coverage permanently into settled coverage", async function () {
    const fixture = await deployFixture();
    await fixture.manager.fundContract({ value: ethers.parseEther("1") });
    await submit(fixture.manager, fixture.user, "settled", ethers.parseEther("0.2"));
    await approve(fixture.manager, fixture, 1);
    const before = await fixture.economics.getCoverageAccount(1);
    await fixture.manager.connect(fixture.user).withdrawSettlement(1);
    const after = await fixture.economics.getCoverageAccount(1);
    expect(after.reservedCoverageWei).to.equal(0);
    expect(after.settledCoverageWei).to.equal(before.reservedCoverageWei);
    expect(after.settledCoverageWei).to.be.greaterThan(0);
  });

  it("does not create retroactive coverage across lapse and reinstatement", async function () {
    const fixture = await deployFixture({ configuredRules: {} });
    const policyBefore = await fixture.manager.getPolicy(1);
    const gapIncident = policyBefore.nextPremiumDueDate + 1n;
    await time.increaseTo(policyBefore.gracePeriodEnd + 1n);
    await fixture.manager.connect(fixture.user).reinstatePolicy(1, { value: premium });

    await expect(
      submit(fixture.manager, fixture.user, "lapse-gap", ethers.parseEther("0.1"), gapIncident)
    ).to.be.reverted;
    const intervals = await fixture.economics.getCoverageIntervals(1);
    expect(intervals).to.have.length(2);
    expect(intervals[1].startsAt).to.be.greaterThan(intervals[0].endsAt);
  });

  it("keeps purchased terms immutable when package rules advance", async function () {
    const fixture = await deployFixture({ configuredRules: {} });
    const oldTerms = await fixture.economics.getPolicyTerms(1);
    await publishRules(fixture.economics, 2, {
      maximumClaimWei: ethers.parseEther("0.05"),
    });
    await fixture.manager.connect(fixture.user).purchasePolicy(1, { value: premium });

    await submit(fixture.manager, fixture.user, "old-policy", ethers.parseEther("0.1"));
    const newTerms = await fixture.economics.getPolicyTerms(2);
    expect(oldTerms.maximumClaimWei).to.equal(coverage);
    expect(newTerms.maximumClaimWei).to.equal(ethers.parseEther("0.05"));
  });

  it("enforces waiting periods, allowed services, exclusions, deadlines, and documents", async function () {
    const fixture = await deployFixture({
      configuredRules: {
        waitingPeriod: 7 * 24 * 60 * 60,
        minimumDocumentCommitments: 2,
      },
    });
    const policy = await fixture.manager.getPolicy(1);
    await expect(
      submit(fixture.manager, fixture.user, "waiting-docs", ethers.parseEther("0.1"), policy.startDate)
    ).to.be.reverted;

    const second = await deployFixture({
      configuredRules: {
        excludedServices: [hash("SURGERY")],
      },
    });
    await expect(
      submit(second.manager, second.user, "excluded")
    ).to.be.reverted;
  });

  it("allows covered incidents during grace but not incidents after paid-through", async function () {
    const fixture = await deployFixture({ configuredRules: {} });
    const policy = await fixture.manager.getPolicy(1);
    await time.increaseTo(policy.nextPremiumDueDate + 2n);
    await submit(
      fixture.manager,
      fixture.user,
      "covered-before-due",
      ethers.parseEther("0.1"),
      policy.nextPremiumDueDate - 1n
    );
    await expect(
      submit(
        fixture.manager,
        fixture.user,
        "not-covered-after-due",
        ethers.parseEther("0.1"),
        policy.nextPremiumDueDate + 1n
      )
    ).to.be.reverted;
  });

  it("prevents a canonical invoice identity from entering a second claim", async function () {
    const fixture = await deployFixture();
    const policy = await fixture.manager.getPolicy(1);
    const invoice = hash("provider-signed-invoice-1");
    const submitInvoice = (documentSuffix) =>
      fixture.manager.connect(fixture.user).submitClaim(
        1,
        ethers.parseEther("0.1"),
        policy.startDate,
        "SURGERY",
        "HOSP-001",
        invoice,
        hash(`document-${documentSuffix}`),
        `ipfs://${documentSuffix}`
      );
    await submitInvoice("one");
    await expect(submitInvoice("two")).to.be.reverted;
  });

  it("blocks treasury withdrawals that breach exposure reserves or the capital buffer", async function () {
    const fixture = await deployFixture();
    await fixture.manager.fundContract({ value: ethers.parseEther("1") });
    await expect(
      fixture.manager.withdrawExcess(ethers.parseEther("0.87"))
    ).to.be.reverted;
    await expect(fixture.manager.withdrawExcess(ethers.parseEther("0.8"))).to.emit(
      fixture.manager,
      "ExcessWithdrawn"
    );
  });

  it("releases only unused exposure after a policy term expires", async function () {
    const fixture = await deployFixture();
    await submit(fixture.manager, fixture.user, "expiry-reserve", ethers.parseEther("0.2"));
    const account = await fixture.economics.getCoverageAccount(1);
    const policy = await fixture.manager.getPolicy(1);
    await time.increaseTo(policy.endDate + 1n);
    await fixture.economics.connect(fixture.other).closeExpiredExposure(1);
    expect(await fixture.economics.activeExposureWei()).to.equal(
      account.reservedCoverageWei
    );
  });

  it("attributes referenced ETH funding while retaining ETH in the manager", async function () {
    const fixture = await deployFixture();
    const reference = hash("treasury-wire-2026-08-15");
    await expect(
      fixture.economics
        .connect(fixture.other)
        .fundTreasury(reference, { value: ethers.parseEther("0.25") })
    )
      .to.emit(fixture.economics, "TreasuryFundingAttributed")
      .withArgs(fixture.other.address, reference, ethers.parseEther("0.25"));
    expect(
      await ethers.provider.getBalance(await fixture.manager.getAddress())
    ).to.equal(premium + ethers.parseEther("0.25"));
  });
});
