const test = require("node:test");
const assert = require("node:assert/strict");
const { ethers } = require("ethers");

const { POLICY_RULES } = require("../config/policyRules");
const {
  evaluatePolicyEligibility,
  getPolicyTerms,
  getRealisticClaimScenarios,
  resolveRuleSetId,
} = require("../services/policyRuleService");

const DAY_SECONDS = 24 * 60 * 60;
const NOW = 1_800_000_000;

const standardInput = (overrides = {}) => ({
  terms: POLICY_RULES.STANDARD_HEALTH,
  policyStartDate: NOW - 120 * DAY_SECONDS,
  policyEndDate: NOW + 245 * DAY_SECONDS,
  incidentDate: NOW - DAY_SECONDS,
  claimType: "SURGERY",
  claimAmountWei: ethers.parseEther("0.2").toString(),
  coverageAmountWei: ethers.parseEther("1").toString(),
  preExistingCondition: false,
  disclosedAtPurchase: false,
  ...overrides,
});

test("maps package names and types to versioned policy profiles", () => {
  assert.equal(resolveRuleSetId({ policyType: "Accident Cover" }), "ACCIDENT_EMERGENCY");
  assert.equal(resolveRuleSetId({ name: "Critical Illness Plus" }), "CRITICAL_ILLNESS");
  assert.equal(resolveRuleSetId({ name: "Family Health" }), "STANDARD_HEALTH");
  assert.equal(getPolicyTerms({ name: "Family Health" }).version, "2026.1");
});

test("calculates an explainable partial benefit after the waiting period", () => {
  const result = evaluatePolicyEligibility(standardInput());

  assert.equal(result.outcome, "PARTIAL_BENEFIT");
  assert.equal(result.eligible, true);
  assert.equal(result.amounts.estimatedBenefitEth, "0.16");
  assert.equal(result.reasons[0].code, "POLICY_SHARE_APPLIED");
});

test("identifies initial and pre-existing-condition waiting periods", () => {
  const initialWait = evaluatePolicyEligibility(
    standardInput({
      policyStartDate: NOW - 10 * DAY_SECONDS,
      incidentDate: NOW - DAY_SECONDS,
    })
  );
  const preExistingWait = evaluatePolicyEligibility(
    standardInput({
      policyStartDate: NOW - 180 * DAY_SECONDS,
      preExistingCondition: true,
      disclosedAtPurchase: true,
    })
  );

  assert.equal(initialWait.outcome, "WAITING_PERIOD");
  assert.equal(initialWait.reasons[0].code, "INITIAL_WAITING_PERIOD");
  assert.equal(preExistingWait.outcome, "WAITING_PERIOD");
  assert.equal(preExistingWait.reasons[0].code, "PRE_EXISTING_WAITING_PERIOD");
});

test("routes non-disclosure and unlisted treatments to human review", () => {
  const nonDisclosure = evaluatePolicyEligibility(
    standardInput({
      policyStartDate: NOW - 400 * DAY_SECONDS,
      preExistingCondition: true,
      disclosedAtPurchase: false,
    })
  );
  const unknownTreatment = evaluatePolicyEligibility(
    standardInput({ claimType: "SPECIALIST_REHABILITATION" })
  );

  assert.equal(nonDisclosure.outcome, "MANUAL_REVIEW");
  assert.equal(nonDisclosure.requiresManualReview, true);
  assert.equal(unknownTreatment.outcome, "MANUAL_REVIEW");
});

test("blocks explicit exclusions and incidents outside policy dates", () => {
  const excluded = evaluatePolicyEligibility(standardInput({ claimType: "COSMETIC" }));
  const expired = evaluatePolicyEligibility(
    standardInput({ incidentDate: NOW + 300 * DAY_SECONDS })
  );

  assert.equal(excluded.outcome, "EXCLUDED");
  assert.equal(excluded.amounts.estimatedBenefitWei, "0");
  assert.equal(expired.outcome, "OUTSIDE_COVERAGE");
});

test("keeps realistic scenarios synthetic, reproducible, and consistent", () => {
  const scenarios = getRealisticClaimScenarios();

  assert.equal(scenarios.length, 6);
  for (const scenario of scenarios) {
    const result = evaluatePolicyEligibility({
      terms: POLICY_RULES[scenario.ruleSetId],
      ...scenario.simulationInput,
    });
    assert.equal(result.outcome, scenario.expectedOutcome, scenario.scenarioId);
  }
});
