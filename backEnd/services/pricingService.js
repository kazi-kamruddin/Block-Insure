const RISK_MULTIPLIER_BPS = {
  LOW: 9000,
  MEDIUM: 10000,
  HIGH: 12500,
};

const TREATMENT_MULTIPLIER_BPS = {
  CHECKUP: 9500,
  CONSULTATION: 9500,
  HOSPITALIZATION: 11000,
  SURGERY: 13000,
  EMERGENCY: 12500,
};

const AGE_BAND_MULTIPLIER_BPS = {
  UNDER_30: 9500,
  "30_45": 10000,
  "46_60": 11500,
  OVER_60: 13500,
};

const normalizeKey = (value, fallback) =>
  String(value || fallback)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

const clampBps = (value, fallback) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }

  return Math.min(Math.max(Math.round(numericValue * 10000), 5000), 30000);
};

const multiplyWeiByBps = (amountWei, multiplierBps) =>
  (BigInt(amountWei) * BigInt(multiplierBps)) / 10000n;

const quoteRiskAdjustedPremium = ({
  basePremiumWei,
  ageBand = "30_45",
  claimHistoryCount = 0,
  selectedRiskLevel = "MEDIUM",
  treatmentCategory = "CONSULTATION",
  manualMultiplier = null,
}) => {
  const riskKey = normalizeKey(selectedRiskLevel, "MEDIUM");
  const treatmentKey = normalizeKey(treatmentCategory, "CONSULTATION");
  const ageKey = normalizeKey(ageBand, "30_45");
  const claimHistoryBps = 10000 + Math.min(Number(claimHistoryCount || 0), 5) * 500;
  const manualBps = manualMultiplier
    ? clampBps(manualMultiplier, 10000)
    : 10000;

  const factors = [
    RISK_MULTIPLIER_BPS[riskKey] || RISK_MULTIPLIER_BPS.MEDIUM,
    TREATMENT_MULTIPLIER_BPS[treatmentKey] || 10000,
    AGE_BAND_MULTIPLIER_BPS[ageKey] || AGE_BAND_MULTIPLIER_BPS["30_45"],
    claimHistoryBps,
    manualBps,
  ];
  const combinedBps = factors.reduce(
    (total, factorBps) => Math.round((total * factorBps) / 10000),
    10000
  );
  const finalPremiumWei = multiplyWeiByBps(basePremiumWei, combinedBps);

  return {
    model: "transparent_demo_multiplier",
    advisoryOnly: true,
    note:
      "Risk pricing is a thesis demo quote. The current contract package premium remains the authoritative purchase amount.",
    basePremiumWei: basePremiumWei.toString(),
    multiplierBps: combinedBps,
    multiplier: Number((combinedBps / 10000).toFixed(4)),
    finalPremiumWei: finalPremiumWei.toString(),
    factors: {
      selectedRiskLevel: riskKey,
      riskMultiplierBps: factors[0],
      treatmentCategory: treatmentKey,
      treatmentMultiplierBps: factors[1],
      ageBand: ageKey,
      ageMultiplierBps: factors[2],
      claimHistoryCount: Number(claimHistoryCount || 0),
      claimHistoryMultiplierBps: claimHistoryBps,
      manualMultiplier,
      manualMultiplierBps: manualBps,
    },
  };
};

module.exports = {
  quoteRiskAdjustedPremium,
};
