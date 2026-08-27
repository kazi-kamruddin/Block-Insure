const { ethers } = require("ethers");
const { POLICY_RULES } = require("../config/policyRules");
const realisticClaimScenarios = require("../config/realisticClaimScenarios");

const DAY_SECONDS = 24 * 60 * 60;

const createInputError = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const normalizeClaimType = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

const resolveRuleSetId = ({ name = "", policyType = "" } = {}) => {
  const source = normalizeClaimType(`${name} ${policyType}`);

  if (/ACCIDENT|EMERGENCY|TRAUMA/.test(source)) return "ACCIDENT_EMERGENCY";
  if (/CRITICAL|CANCER|STROKE|HEART/.test(source)) return "CRITICAL_ILLNESS";
  return "STANDARD_HEALTH";
};

const getPolicyTerms = (policyPackage = {}) => {
  const ruleSetId = resolveRuleSetId(policyPackage);
  return { ...POLICY_RULES[ruleSetId] };
};

const parseUnixSeconds = (value, fieldName) => {
  if (value === undefined || value === null || value === "") {
    throw createInputError(`${fieldName} is required`);
  }

  if (/^\d+$/.test(String(value))) {
    const numericValue = Number(value);
    if (Number.isSafeInteger(numericValue) && numericValue > 0) return numericValue;
  }

  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);

  throw createInputError(`${fieldName} must be an ISO date or Unix timestamp`);
};

const parseWei = (value, fieldName) => {
  try {
    const amount = BigInt(String(value));
    if (amount < 0n) throw new Error("negative");
    return amount;
  } catch {
    throw createInputError(`${fieldName} must be a non-negative integer in wei`);
  }
};

const createReason = (code, message, effect) => ({ code, message, effect });

const evaluatePolicyEligibility = ({
  terms,
  policyStartDate,
  policyEndDate,
  incidentDate,
  claimType,
  claimAmountWei,
  coverageAmountWei,
  preExistingCondition = false,
  disclosedAtPurchase = false,
}) => {
  const start = parseUnixSeconds(policyStartDate, "policyStartDate");
  const end = parseUnixSeconds(policyEndDate, "policyEndDate");
  const incident = parseUnixSeconds(incidentDate, "incidentDate");
  const requestedWei = parseWei(claimAmountWei, "claimAmountWei");
  const coverageWei = parseWei(coverageAmountWei, "coverageAmountWei");
  const normalizedType = normalizeClaimType(claimType);

  if (end <= start) throw createInputError("policyEndDate must be after policyStartDate");
  if (!normalizedType) throw createInputError("claimType is required");

  const reasons = [];
  const daysFromStart = Math.floor((incident - start) / DAY_SECONDS);
  let outcome = "COVERED";

  if (incident < start) {
    outcome = "OUTSIDE_COVERAGE";
    reasons.push(
      createReason("INCIDENT_BEFORE_POLICY", "Incident predates policy coverage.", "BLOCK")
    );
  } else if (incident > end) {
    outcome = "OUTSIDE_COVERAGE";
    reasons.push(
      createReason("INCIDENT_AFTER_POLICY", "Incident occurred after policy expiry.", "BLOCK")
    );
  }

  if (outcome === "COVERED" && terms.excludedClaimTypes.includes(normalizedType)) {
    outcome = "EXCLUDED";
    reasons.push(
      createReason(
        "EXPLICIT_EXCLUSION",
        `${normalizedType.replaceAll("_", " ")} is excluded by this policy profile.`,
        "BLOCK"
      )
    );
  }

  if (
    outcome === "COVERED" &&
    !terms.coveredClaimTypes.includes(normalizedType)
  ) {
    outcome = "MANUAL_REVIEW";
    reasons.push(
      createReason(
        "UNLISTED_CLAIM_TYPE",
        "The claim type is not explicitly listed and requires policy interpretation.",
        "REVIEW"
      )
    );
  }

  if (
    outcome === "COVERED" &&
    preExistingCondition &&
    daysFromStart < terms.preExistingConditionWaitingDays
  ) {
    outcome = "WAITING_PERIOD";
    reasons.push(
      createReason(
        "PRE_EXISTING_WAITING_PERIOD",
        `The ${terms.preExistingConditionWaitingDays}-day pre-existing-condition waiting period is incomplete.`,
        "BLOCK"
      )
    );
  } else if (
    outcome === "COVERED" &&
    daysFromStart < terms.waitingPeriodDays
  ) {
    outcome = "WAITING_PERIOD";
    reasons.push(
      createReason(
        "INITIAL_WAITING_PERIOD",
        `The ${terms.waitingPeriodDays}-day initial waiting period is incomplete.`,
        "BLOCK"
      )
    );
  }

  if (
    outcome === "COVERED" &&
    preExistingCondition &&
    !disclosedAtPurchase
  ) {
    outcome = "MANUAL_REVIEW";
    reasons.push(
      createReason(
        "NON_DISCLOSURE_REVIEW",
        "A declared pre-existing condition was not disclosed at purchase and needs human review.",
        "REVIEW"
      )
    );
  }

  const cappedWei = requestedWei < coverageWei ? requestedWei : coverageWei;
  const estimatedBenefitWei =
    outcome === "COVERED" || outcome === "MANUAL_REVIEW"
      ? (cappedWei * BigInt(terms.coinsuranceBps)) / 10000n
      : 0n;

  if (outcome === "COVERED" && estimatedBenefitWei < requestedWei) {
    outcome = "PARTIAL_BENEFIT";
    reasons.push(
      createReason(
        "POLICY_SHARE_APPLIED",
        `Estimated benefit applies the policy's ${terms.coinsuranceBps / 100}% share and coverage cap.`,
        "LIMIT"
      )
    );
  }

  if (reasons.length === 0) {
    reasons.push(createReason("TERMS_SATISFIED", "The supplied facts satisfy this policy profile.", "ALLOW"));
  }

  return {
    advisoryOnly: true,
    outcome,
    eligible: ["COVERED", "PARTIAL_BENEFIT"].includes(outcome),
    requiresManualReview: outcome === "MANUAL_REVIEW",
    ruleSet: {
      ruleSetId: terms.ruleSetId,
      version: terms.version,
      displayName: terms.displayName,
    },
    dates: {
      policyStartDate: new Date(start * 1000).toISOString(),
      policyEndDate: new Date(end * 1000).toISOString(),
      incidentDate: new Date(incident * 1000).toISOString(),
      daysFromPolicyStart: daysFromStart,
    },
    amounts: {
      requestedWei: requestedWei.toString(),
      requestedEth: ethers.formatEther(requestedWei),
      coverageLimitWei: coverageWei.toString(),
      coverageLimitEth: ethers.formatEther(coverageWei),
      estimatedBenefitWei: estimatedBenefitWei.toString(),
      estimatedBenefitEth: ethers.formatEther(estimatedBenefitWei),
    },
    reasons,
    notice: terms.notice,
  };
};

const materializeScenario = (scenario, now = new Date()) => {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const start = nowSeconds + scenario.input.policyStartOffsetDays * DAY_SECONDS;
  const incident = nowSeconds + scenario.input.incidentOffsetDays * DAY_SECONDS;
  const end = nowSeconds + 30 * DAY_SECONDS;

  return {
    ...scenario,
    simulationInput: {
      policyStartDate: start,
      policyEndDate: end,
      incidentDate: incident,
      claimType: scenario.input.claimType,
      claimAmountWei: ethers.parseEther(scenario.input.claimAmountEth).toString(),
      coverageAmountWei: ethers.parseEther(scenario.input.coverageAmountEth).toString(),
      preExistingCondition: scenario.input.preExistingCondition,
      disclosedAtPurchase: scenario.input.disclosedAtPurchase,
    },
  };
};

const getRealisticClaimScenarios = () =>
  realisticClaimScenarios.map((scenario) => materializeScenario(scenario));

module.exports = {
  evaluatePolicyEligibility,
  getPolicyTerms,
  getRealisticClaimScenarios,
  normalizeClaimType,
  resolveRuleSetId,
};
