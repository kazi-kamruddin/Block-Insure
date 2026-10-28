const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { ethers } = require("ethers");
const { hashPassword, verifyPassword } = require("../services/hospitalStaffService");
const { invoiceIdentity, patientIdentity } = require("../../oracle/recordIdentity");
const { buildRulePublication } = require("../services/packageRuleDefinitionService");
const { formatTerms } = require("../services/issuedPolicyTermsService");
const { evaluatePolicyEligibility } = require("../services/policyRuleService");
const { buildPolicyDocument } = require("../services/policyDocumentService");
const load = require("./helpers/loadIsolatedModule");

test("staff credentials use salted scrypt and never accept a corrupted credential", async () => {
  const password = "synthetic-test-only-password";
  const first = await hashPassword(password), second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("incorrect-password", first), false);
  assert.equal(await verifyPassword(password, "corrupted"), false);
  await assert.rejects(hashPassword("short"), (error) => error.statusCode === 422);
});

test("hospital credential audience, revocation and network suspension are enforced separately from SIWE", async () => {
  const environment = { JWT_SECRET: "synthetic-test-only-session-secret" };
  const staff = { _id: "a".repeat(24), username: "test.staff", displayName: "Test staff", hospitalId: "HOSP-001", sessionVersion: 3 };
  let contracted = true;
  const service = load("services/hospitalStaffService.js", {
    "../models/HospitalStaff": { findOne: () => ({ select: async () => staff }) },
    "../models/Hospital": { findOne: () => ({ lean: async () => contracted ? {} : null }) },
  }, environment);
  const sign = (changes = {}, audience = "block-insure-hospital-staff") => jwt.sign({ authMethod: "HOSPITAL_STAFF", sessionVersion: 3, ...changes }, environment.JWT_SECRET,
    { subject: String(staff._id), audience, issuer: "block-insure-api", expiresIn: "1h" });
  assert.equal((await service.authenticateStaff(sign())).hospitalId, "HOSP-001");
  await assert.rejects(service.authenticateStaff(sign({}, "block-insure-client")));
  await assert.rejects(service.authenticateStaff(sign({ sessionVersion: 2 })), (error) => error.statusCode === 401);
  await assert.rejects(service.authenticateStaff(sign({ authMethod: "SIWE" })), (error) => error.statusCode === 401);
  contracted = false;
  await assert.rejects(service.authenticateStaff(sign()), (error) => error.statusCode === 403);
});

test("equal issuer-local invoice and patient strings never merge different hospitals", () => {
  assert.notEqual(invoiceIdentity("HOSP-001", "001"), invoiceIdentity("HOSP-002", "001"));
  assert.notEqual(patientIdentity("HOSP-001", "PAT-1"), patientIdentity("HOSP-002", "PAT-1"));
  assert.notEqual(invoiceIdentity("HOSP-001", "001"), patientIdentity("HOSP-001", "001"));
  assert.equal(invoiceIdentity(" hosp-001 ", "001 "), invoiceIdentity("HOSP-001", "001"));
});

test("custom configured rules drive the document and deductible/share estimate without name inference", () => {
  const definition = { allowedClaimTypes: ["CUSTOM_MEDICAL"], excludedClaimTypes: ["COSMETIC"], requiredDocumentTypes: ["HOSPITAL_BILL"],
    minimumDocumentCommitments: 1, deductibleRateBps: 750, deductibleCapEth: "0.015", insurerShareBps: 6500,
    maximumClaimEth: "0.8", waitingPeriodDays: 2, reinstatementWaitingPeriodDays: 1, claimDeadlineDays: 180 };
  const publication = buildRulePublication(7, 4, definition);
  const terms = formatTerms(publication.rules, { allowed: publication.allowedServices, excluded: publication.excludedServices,
    labels: { [ethers.id("CUSTOM_MEDICAL")]: "CUSTOM_MEDICAL", [ethers.id("COSMETIC")]: "COSMETIC" } });
  const now = Math.floor(Date.now() / 1000);
  const input = { terms, policyStartDate: now - 10 * 86400, policyEndDate: now + 350 * 86400, incidentDate: now,
    claimType: "CUSTOM_MEDICAL", claimAmountWei: ethers.parseEther("0.2"), coverageAmountWei: ethers.parseEther("1") };
  const estimate = evaluatePolicyEligibility(input);
  assert.equal(estimate.amounts.estimatedBenefitWei, ethers.parseEther("0.12025").toString());
  assert.equal(evaluatePolicyEligibility({ ...input, preExistingCondition: true }).eligible, true);
  assert.equal(evaluatePolicyEligibility({ ...input, terms: { ...terms, remainingCoverageWei: ethers.parseEther("0.01").toString() } }).eligible, false);
  assert.equal(evaluatePolicyEligibility({ ...input, claimType: "custom_medical" }).eligible, false);
  const document = buildPolicyDocument({ policyPackage: { name: "Critical Accident Name Does Not Define Rules", packageId: "7", policyType: "HEALTH",
    premiumAmountWei: ethers.parseEther("0.01").toString(), premiumAmountEth: "0.01", coverageAmountEth: "1", durationDays: "365",
    requiredDocumentType: "HOSPITAL_BILL", policyTerms: terms, deploymentScope: "synthetic-deployment", issueHash: ethers.id("issue") } });
  assert.match(document.markdown, /Initial waiting period: 2 days/);
  assert.match(document.markdown, /Insurer share after deductible: 65%/);
  assert.match(document.markdown, /CUSTOM_MEDICAL/);
  assert.match(document.markdown, /Last period: 5 days/);
  assert.equal(document.documentHash, ethers.id(document.markdown));
  assert.throws(() => buildRulePublication(7, 5, { ...definition, minimumDocumentCommitments: 2 }), /exactly one/);
  assert.throws(() => buildRulePublication(7, 5, { ...definition, insurerShareBps: 10001 }), /Invalid insurer/);
});
