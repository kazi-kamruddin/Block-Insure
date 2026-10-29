const test = require("node:test");
const assert = require("node:assert/strict");
const { ethers } = require("ethers");
const { buildPolicyDocument } = require("../services/policyDocumentService");
const policyPackage = { packageId: "1", name: "Custom Health", policyType: "HEALTH", premiumAmountWei: ethers.parseEther("0.01").toString(), premiumAmountEth: "0.01", coverageAmountEth: "1", durationDays: "365", requiredDocumentType: "HOSPITAL_BILL", deploymentScope: "isolated-test", issueHash: ethers.id("offer"),
  policyTerms: { paymentSchedule: require("../services/paymentScheduleService").formatPaymentSchedule({ profileId: ethers.id("QUARTERLY"), intervalSeconds: 90 * 86400, advanceWindowSeconds: 30 * 86400, gracePeriodSeconds: 7 * 86400 }), authoritative: true, version: "2", waitingPeriodDays: 7, reinstatementWaitingPeriodDays: 2, claimDeadlineDays: 180,
    maximumClaimWei: ethers.parseEther("1").toString(), deductibleRateBps: 1000, deductibleCapWei: ethers.parseEther("0.02").toString(), coinsuranceBps: 8000,
    coveredClaimTypes: ["SURGERY"], excludedClaimTypes: ["COSMETIC"], policyRuleVersion: ethers.id("rules"), settlementFormulaVersion: ethers.id("formula"), notice: "Academic prototype" } };

test("policy documents deterministically bind the published medical rules and deployment", () => {
  const first = buildPolicyDocument({ policyPackage });
  assert.equal(first.documentHash, buildPolicyDocument({ policyPackage }).documentHash);
  assert.equal(first.documentVersion, "medical-rules.2-schedule.3-QUARTERLY");
  assert.match(first.markdown, /Initial waiting period: 7 days/);
  assert.match(first.markdown, /capped at 0.02 test ETH/);
  assert.match(first.markdown, /acceptance/);
  assert.notEqual(first.documentHash, buildPolicyDocument({ policyPackage: { ...policyPackage, issueHash: ethers.id("changed offer") } }).documentHash);
});

test("accelerated documents disclose the actual immutable testnet calendar and cannot inherit quarterly wording", () => {
  const { formatPaymentSchedule } = require("../services/paymentScheduleService");
  const paymentSchedule = formatPaymentSchedule({ profileId: ethers.id("ACCELERATED_TESTNET"), intervalSeconds: 600, advanceWindowSeconds: 480, gracePeriodSeconds: 120 });
  const document = buildPolicyDocument({ policyPackage: { ...policyPackage, policyTerms: { ...policyPackage.policyTerms, paymentSchedule } } });
  assert.match(document.markdown, /Accelerated testnet payment demo/);
  assert.match(document.markdown, /every 10 minutes/);
  assert.match(document.markdown, /starting 8 minutes before/);
  assert.doesNotMatch(document.markdown, /every 90 days|Seven-day collection/);
  assert.notEqual(document.documentHash, buildPolicyDocument({ policyPackage }).documentHash);
  assert.throws(() => formatPaymentSchedule({ profileId: ethers.id("QUARTERLY"), intervalSeconds: 600, advanceWindowSeconds: 480, gracePeriodSeconds: 120 }), /inconsistent/);
  assert.throws(() => formatPaymentSchedule({ profileId: ethers.id("invented"), intervalSeconds: 600, advanceWindowSeconds: 480, gracePeriodSeconds: 120 }), /Unsupported/);
});
test("unconfigured offers cannot invent policy documents from a package name", () => {
  assert.throws(() => buildPolicyDocument({ policyPackage: { name: "Health Basic" } }), /Published contract terms/);
});
test("later auxiliary benefit changes do not change an accepted medical document", () => {
  assert.equal(buildPolicyDocument({ policyPackage, benefitTerms: { version: 1 } }).documentHash,
    buildPolicyDocument({ policyPackage, benefitTerms: { version: 2 } }).documentHash);
});
