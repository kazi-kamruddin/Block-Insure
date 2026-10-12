const test = require("node:test");
const assert = require("node:assert/strict");

const { buildPolicyDocument } = require("../services/policyDocumentService");

const policyPackage = {
  packageId: "1",
  name: "Supervisor Demo Health",
  policyType: "HEALTH",
  premiumAmountEth: "0.01",
  coverageAmountEth: "1.0",
  durationDays: "365",
  requiredDocumentType: "HOSPITAL_BILL",
};

const benefits = {
  configured: true,
  version: 2,
  deathBenefitEnabled: true,
  deathBenefitPercent: 100,
  surrenderEnabled: true,
  surrenderValuePercent: 50,
  minimumSurrenderInstallments: 6,
  maturityEnabled: true,
  maturityBonusPercent: 10,
  termsHash: `0x${"1".repeat(64)}`,
};

test("builds a deterministic, versioned public policy document", () => {
  const first = buildPolicyDocument({ policyPackage, benefitTerms: benefits });
  const second = buildPolicyDocument({ policyPackage, benefitTerms: benefits });

  assert.equal(first.documentVersion, "2026.1-benefits.2");
  assert.equal(first.documentHash, second.documentHash);
  assert.match(first.documentHash, /^0x[0-9a-f]{64}$/);
  assert.match(first.markdown, /Initial waiting period: 30 days/);
  assert.match(first.markdown, /Surrender value: 50%/);
  assert.match(first.markdown, /Digital Acceptance/);
});

test("changes the commitment when the published benefit schedule changes", () => {
  const original = buildPolicyDocument({ policyPackage, benefitTerms: benefits });
  const revised = buildPolicyDocument({
    policyPackage,
    benefitTerms: { ...benefits, version: 3, surrenderValuePercent: 60 },
  });

  assert.notEqual(original.documentVersion, revised.documentVersion);
  assert.notEqual(original.documentHash, revised.documentHash);
});
