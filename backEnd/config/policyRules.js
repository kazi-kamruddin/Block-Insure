const POLICY_RULE_NOTICE =
  "Illustrative thesis configuration. The deployed smart contract and issued policy remain authoritative.";

const POLICY_RULES = {
  STANDARD_HEALTH: {
    ruleSetId: "STANDARD_HEALTH",
    version: "2026.1",
    displayName: "Standard Health",
    summary: "General hospitalization cover with a waiting period and shared settlement.",
    waitingPeriodDays: 30,
    preExistingConditionWaitingDays: 365,
    coinsuranceBps: 8000,
    coveredClaimTypes: [
      "HOSPITALIZATION",
      "SURGERY",
      "EMERGENCY",
      "CONSULTATION",
    ],
    excludedClaimTypes: ["COSMETIC", "DENTAL_COSMETIC", "SELF_INFLICTED"],
    requiredDisclosures: ["PRE_EXISTING_CONDITION"],
    notice: POLICY_RULE_NOTICE,
  },
  CRITICAL_ILLNESS: {
    ruleSetId: "CRITICAL_ILLNESS",
    version: "2026.1",
    displayName: "Critical Illness",
    summary: "Named-condition cover with a longer initial and pre-existing-condition wait.",
    waitingPeriodDays: 90,
    preExistingConditionWaitingDays: 730,
    coinsuranceBps: 10000,
    coveredClaimTypes: [
      "CRITICAL_ILLNESS",
      "CANCER",
      "STROKE",
      "HEART_ATTACK",
    ],
    excludedClaimTypes: ["COSMETIC", "EXPERIMENTAL_TREATMENT"],
    requiredDisclosures: ["PRE_EXISTING_CONDITION"],
    notice: POLICY_RULE_NOTICE,
  },
  ACCIDENT_EMERGENCY: {
    ruleSetId: "ACCIDENT_EMERGENCY",
    version: "2026.1",
    displayName: "Accident and Emergency",
    summary: "Immediate accidental injury and emergency cover with no initial wait.",
    waitingPeriodDays: 0,
    preExistingConditionWaitingDays: 0,
    coinsuranceBps: 9000,
    coveredClaimTypes: ["ACCIDENT", "EMERGENCY", "TRAUMA", "SURGERY"],
    excludedClaimTypes: ["COSMETIC", "SELF_INFLICTED", "ROUTINE_CHECKUP"],
    requiredDisclosures: [],
    notice: POLICY_RULE_NOTICE,
  },
};

module.exports = {
  POLICY_RULE_NOTICE,
  POLICY_RULES,
};
