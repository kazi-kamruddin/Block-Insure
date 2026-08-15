const crypto = require("node:crypto");

const DATASET_PROFILES = {
  normal: { fraudRate: 0.09, compromiseRate: 0.03, drift: 0, noiseRate: 0.08 },
  high_fraud_stress: { fraudRate: 0.32, compromiseRate: 0.15, drift: 0.04, noiseRate: 0.12 },
  provider_compromise: { fraudRate: 0.1, compromiseRate: 0.45, drift: 0.02, noiseRate: 0.1 },
  temporal_distribution_shift: { fraudRate: 0.08, compromiseRate: 0.05, drift: 0.25, noiseRate: 0.16 },
};

const createRandom = (seed) => {
  let state = Number.parseInt(
    crypto.createHash("sha256").update(String(seed)).digest("hex").slice(0, 8),
    16
  ) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const choose = (random, values) => values[Math.floor(random() * values.length)];
const addDays = (date, days) => new Date(date.getTime() + days * 86400000);
const hash = (value) => `0x${crypto.createHash("sha256").update(value).digest("hex")}`;

const generateSyntheticDataset = ({ profile = "normal", seed = 202605, size = 600 } = {}) => {
  const settings = DATASET_PROFILES[profile];
  if (!settings) throw new Error(`Unknown synthetic profile: ${profile}`);
  const random = createRandom(`${profile}:${seed}`);
  const providers = Array.from({ length: 24 }, (_, index) => ({
    id: `HOSP-${String(index + 1).padStart(3, "0")}`,
    compromised: random() < settings.compromiseRate,
    baseCost: 0.06 + random() * 0.5,
  }));
  const families = Array.from({ length: 110 }, (_, index) => `FAMILY-${String(index + 1).padStart(3, "0")}`);
  const claimants = Array.from({ length: 260 }, (_, index) => ({
    id: `CLAIMANT-${String(index + 1).padStart(4, "0")}`,
    familyId: families[index % families.length],
    providerId: providers[index % providers.length].id,
    hiddenCollusion: random() < settings.fraudRate * 0.45,
  }));
  const treatments = ["HOSPITALIZATION", "SURGERY", "EMERGENCY", "DIAGNOSTIC", "MATERNITY"];
  const records = [];
  const sequenceCounts = new Map();
  const baseDate = new Date("2023-01-01T00:00:00.000Z");

  for (let index = 0; index < size; index += 1) {
    const progress = index / Math.max(size - 1, 1);
    const claimant = choose(random, claimants);
    const provider = providers.find((item) => item.id === claimant.providerId);
    const previousClaimCount = sequenceCounts.get(claimant.id) || 0;
    sequenceCounts.set(claimant.id, previousClaimCount + 1);
    const treatmentType = choose(random, treatments);
    const recurringLegitimate = !claimant.hiddenCollusion && previousClaimCount > 0 && random() < 0.22;

    // Fraud is sampled from hidden causal state. Observable features below are noisy
    // consequences and are deliberately not used as the label rule.
    const latentProbability = Math.min(
      0.92,
      settings.fraudRate +
        (provider.compromised ? 0.28 : 0) +
        (claimant.hiddenCollusion ? 0.34 : 0) +
        settings.drift * progress -
        (recurringLegitimate ? 0.08 : 0)
    );
    const actualFraud = random() < latentProbability;
    const signalProbability = actualFraud ? 0.58 : 0.035 + settings.noiseRate * 0.25;
    const usedInvoice = random() < signalProbability * 0.22;
    const cancelledRecord = random() < signalProbability * 0.13;
    const inflatedAmount = random() < signalProbability * 0.38;
    const dateMismatch = random() < signalProbability * 0.16;
    const blacklistedHospital = random() < signalProbability * 0.1;
    const providerVelocityAnomaly = random() < (actualFraud ? 0.42 : 0.07);
    const claimantVelocityAnomaly = random() < (actualFraud ? 0.35 : recurringLegitimate ? 0.16 : 0.05);
    const duplicateVariant = random() < (actualFraud ? 0.31 : 0.025);
    const noisy = random() < settings.noiseRate;
    const expectedMin = provider.baseCost * (treatmentType === "SURGERY" ? 1.8 : 0.7);
    const expectedMax = expectedMin * 2.4;
    const amountMultiplier = inflatedAmount ? 1.45 + random() : 1 + (random() - 0.5) * 0.65;
    const billAmount = Math.max(expectedMin * 0.8, expectedMin * amountMultiplier);
    const occurredAt = addDays(baseDate, Math.floor(progress * 1095 + random() * 14));
    const invoiceNumber = duplicateVariant && records.length
      ? `${records[Math.floor(random() * records.length)].invoiceNumber}-REV`
      : `INV-${provider.id}-${String(index + 1).padStart(6, "0")}`;
    const labelTypes = ["USED_INVOICE", "INFLATED_AMOUNT", "SUSPICIOUS_PATTERN", "DATE_MISMATCH"];

    records.push({
      recordId: `${profile}-${seed}-${index + 1}`,
      datasetProfile: profile,
      claimantId: claimant.id,
      patientHash: hash(claimant.id),
      familyId: claimant.familyId,
      providerId: provider.id,
      hospitalId: provider.id,
      hospitalName: `Synthetic Provider ${provider.id}`,
      division: choose(random, ["Dhaka", "Chattogram", "Sylhet", "Rajshahi", "Khulna"]),
      district: `District ${1 + (index % 16)}`,
      hospitalTier: choose(random, ["PRIMARY", "SECONDARY", "TERTIARY", "SPECIALIZED"]),
      licenseStatus: blacklistedHospital ? "BLACKLISTED" : "ACTIVE",
      patientAgeBand: choose(random, ["CHILD", "ADULT", "ADULT", "SENIOR"]),
      treatmentType,
      diagnosisCode: `${treatmentType.slice(0, 3)}-${100 + (index % 80)}`,
      occurredAt,
      admissionDate: occurredAt,
      dischargeDate: addDays(occurredAt, 1 + (index % 5)),
      invoiceDate: addDays(occurredAt, dateMismatch ? 35 : 2 + (index % 3)),
      billAmount: billAmount.toFixed(4),
      expectedBillMin: expectedMin.toFixed(4),
      expectedBillMax: expectedMax.toFixed(4),
      invoiceNumber,
      invoiceHash: hash(invoiceNumber),
      invoiceStatus: usedInvoice ? "USED" : cancelledRecord ? "CANCELLED" : noisy ? "SUSPICIOUS" : "VALID",
      recordStatus: usedInvoice ? "USED" : cancelledRecord ? "CANCELLED" : "VALID",
      fraudLabel: actualFraud ? choose(random, labelTypes) : "LEGITIMATE",
      actualFraud,
      fraudSignals: { usedInvoice, cancelledRecord, inflatedAmount, blacklistedHospital, dateMismatch },
      previousClaimCount,
      providerVelocityAnomaly,
      claimantVelocityAnomaly,
      nearDuplicateAdvisory: duplicateVariant,
      isMissingOrNoisy: noisy,
      dataQuality: noisy ? "NOISY" : "COMPLETE",
      recurringLegitimate,
      syntheticSource: `phase-5-${profile}-v1`,
      // Retained only for generator validation and never included in the feature schema.
      latentMechanism: {
        compromisedProvider: provider.compromised,
        claimantCollusion: claimant.hiddenCollusion,
        fraudProbability: Number(latentProbability.toFixed(6)),
      },
    });
  }
  return records;
};

const generateAllSyntheticDatasets = ({ seed = 202605, size = 600 } = {}) =>
  Object.fromEntries(
    Object.keys(DATASET_PROFILES).map((profile) => [
      profile,
      generateSyntheticDataset({ profile, seed, size }),
    ])
  );

module.exports = {
  DATASET_PROFILES,
  createRandom,
  generateAllSyntheticDatasets,
  generateSyntheticDataset,
};
