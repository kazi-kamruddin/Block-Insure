const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Phase 5 - stateful financial invariants", function () {
  const hash = (value) => ethers.keccak256(ethers.toUtf8Bytes(value));

  it("preserves coverage and reserve bounds through a randomized claim sequence", async function () {
    const [, user] = await ethers.getSigners();
    const Manager = await ethers.getContractFactory("InsuranceManager");
    const manager = await Manager.deploy();
    const premium = ethers.parseEther("0.01");
    const coverage = ethers.parseEther("1");
    await manager.createPolicyPackage("Invariant Health", "HEALTH", premium, coverage, 365, "BILL");
    await manager.connect(user).purchasePolicy(1, { value: premium });
    const policy = await manager.getPolicy(1);
    const economics = await ethers.getContractAt("PolicyEconomics", await manager.policyEconomics());
    let state = 0x5eed;
    for (let step = 0; step < 24; step += 1) {
      state = (state * 1664525 + 1013904223) >>> 0;
      const amount = ethers.parseEther((0.005 + (state % 15) / 1000).toFixed(3));
      try {
        await manager.connect(user).submitClaim(
          1,
          amount,
          policy.startDate,
          "HOSPITALIZATION",
          "HOSP-001",
          hash(`invariant-invoice-${step}`),
          hash(`invariant-document-${step}`),
          `ipfs://invariant-${step}`
        );
      } catch {
        // A valid state machine may reject once the economic limit is reached.
      }
      const account = await economics.getCoverageAccount(1);
      expect(account.reservedCoverageWei + account.settledCoverageWei).to.be.lte(
        account.coverageLimitWei
      );
      expect(await economics.minimumTreasuryBalance(0)).to.be.gte(account.reservedCoverageWei);
    }
  });
});
