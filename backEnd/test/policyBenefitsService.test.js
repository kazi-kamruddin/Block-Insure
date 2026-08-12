const test = require("node:test");
const assert = require("node:assert/strict");
const { ethers } = require("ethers");

const policyBenefitsAbi = require("../abi/policyBenefitsAbi");
const {
  formatBenefitRequest,
  formatTerms,
} = require("../services/policyBenefitsService");

test("policy benefits ABI exposes every backend operation", () => {
  const contractInterface = new ethers.Interface(policyBenefitsAbi);
  for (const functionName of [
    "getBenefitTerms",
    "getBeneficiaries",
    "getBenefitRequest",
    "calculateBenefit",
    "publishBenefitTerms",
    "approveBenefit",
    "rejectBenefit",
    "settleBenefit",
  ]) {
    assert.ok(contractInterface.getFunction(functionName));
  }
});

test("formats benefit terms and requests without losing integer precision", () => {
  const terms = formatTerms({
    configured: true,
    deathBenefitEnabled: true,
    surrenderEnabled: true,
    maturityEnabled: false,
    deathBenefitBps: 10000n,
    surrenderValueBps: 5000n,
    maturityBonusBps: 0n,
    minimumSurrenderInstallments: 6n,
    version: 2n,
    termsHash: ethers.id("terms-v2"),
  });
  const request = formatBenefitRequest({
    requestId: 1n,
    policyId: 2n,
    packageId: 3n,
    benefitType: 1n,
    status: 2n,
    requester: ethers.Wallet.createRandom().address,
    amount: ethers.parseEther("0.005"),
    evidenceHash: ethers.ZeroHash,
    decisionReasonHash: ethers.ZeroHash,
    termsVersion: 2n,
    requestedAt: 100n,
    resolvedAt: 200n,
    paidAt: 0n,
  });

  assert.equal(terms.surrenderValuePercent, 50);
  assert.equal(terms.version, 2);
  assert.equal(request.benefitType.label, "SURRENDER");
  assert.equal(request.status.label, "APPROVED");
  assert.equal(request.amountEth, "0.005");
});
