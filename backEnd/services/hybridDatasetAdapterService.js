const crypto = require("node:crypto");
const { ethers } = require("ethers");

const HYBRID_DATASET_VERSION = "blockinsure-hybrid-v1.2.0";
const SCENARIO_VERSION = "blockinsure-scenario-v1";
const AMOUNT_NORMALIZATION_VERSION = "usd-demo-scale-v1";
const AMOUNT_NORMALIZATION_DIVISOR = 10000;
const DEFAULT_SEED = 20260828;

const CLAIM_SCENARIOS = [
  "USED_INVOICE",
  "CANCELLED_RECORD",
  "INFLATED_AMOUNT",
  "DATE_MISMATCH",
  "BLACKLISTED_HOSPITAL",
  "NEAR_DUPLICATE",
  "PROVIDER_COMPROMISE",
  "NOISY_RECORD",
];

const CHRONIC_CONDITION_FIELDS = [
  "ChronicCond_Alzheimer",
  "ChronicCond_Heartfailure",
  "ChronicCond_KidneyDisease",
  "ChronicCond_Cancer",
  "ChronicCond_ObstrPulmonary",
  "ChronicCond_Depression",
  "ChronicCond_Diabetes",
  "ChronicCond_IschemicHeart",
  "ChronicCond_Osteoporasis",
  "ChronicCond_rheumatoidarthritis",
  "ChronicCond_stroke",
];

const clean = (value) => {
  const normalized = String(value ?? "").trim();
  return !normalized || normalized.toUpperCase() === "NA" ? "" : normalized;
};

const numberOrZero = (value) => {
  const parsed = Number(clean(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const sha256Hex = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");

const sha256Hash = (value) => `0x${sha256Hex(value)}`;

const hashInvoiceNumber = (invoiceNumber) =>
  ethers.keccak256(ethers.toUtf8Bytes(String(invoiceNumber)));

const stableUnit = (value) =>
  Number.parseInt(sha256Hex(value).slice(0, 8), 16) / 0x100000000;

const createDeterministicSampler = (
  capacity,
  { seed = DEFAULT_SEED, namespace = "sample" } = {}
) => {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new Error("Deterministic sampler capacity must be a positive integer");
  }

  const entries = [];
  let worstIndex = -1;
  let worstScore = "";

  const refreshWorst = () => {
    worstIndex = 0;
    worstScore = entries[0]?.score || "";
    for (let index = 1; index < entries.length; index += 1) {
      if (entries[index].score > worstScore) {
        worstIndex = index;
        worstScore = entries[index].score;
      }
    }
  };

  return {
    consider(key, value) {
      const score = sha256Hex(`${namespace}:${seed}:${key}`);
      if (entries.length < capacity) {
        entries.push({ score, value });
        if (entries.length === capacity) refreshWorst();
        return;
      }
      if (score >= worstScore) return;
      entries[worstIndex] = { score, value };
      refreshWorst();
    },
    values() {
      return entries
        .slice()
        .sort((left, right) => left.score.localeCompare(right.score))
        .map(({ value }) => value);
    },
  };
};

const parseCsvLine = (line) => {
  const values = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
};

const toRow = (headers, values) =>
  Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));

const normalizeDate = (value, fallback = "2009-01-01") => {
  const candidate = clean(value) || fallback;
  const date = new Date(`${candidate}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? new Date(`${fallback}T00:00:00.000Z`) : date;
};

const addDays = (value, days) => {
  const date = new Date(value);
  return new Date(date.getTime() + days * 86400000);
};

const getProviderSplit = (providerId, seed = DEFAULT_SEED) => {
  const bucket = Math.floor(stableUnit(`split:${seed}:${providerId}`) * 100);
  if (bucket < 64) return "train";
  if (bucket < 80) return "calibration";
  return "test";
};

const calculateAgeBand = (dobValue, serviceDateValue) => {
  const dob = normalizeDate(dobValue, "1940-01-01");
  const serviceDate = normalizeDate(serviceDateValue, "2009-01-01");
  const age = Math.max(0, Math.floor((serviceDate - dob) / 31557600000));
  if (age < 18) return "CHILD";
  if (age >= 65) return "SENIOR";
  return "ADULT";
};

const getChronicConditionCount = (beneficiary = {}) =>
  CHRONIC_CONDITION_FIELDS.reduce(
    (count, field) => count + (clean(beneficiary[field]) === "1" ? 1 : 0),
    0
  );

const firstCode = (claim, prefix, maximum) => {
  for (let index = 1; index <= maximum; index += 1) {
    const value = clean(claim[`${prefix}_${index}`]);
    if (value) return value;
  }
  return "";
};

const resolveDiagnosisCode = (claim) =>
  clean(claim.ClmAdmitDiagnosisCode) || firstCode(claim, "ClmDiagnosisCode", 10) || "UNSPECIFIED";

const resolveProcedureCode = (claim) => firstCode(claim, "ClmProcedureCode", 6);

const getSourceClaimAmount = (claim) =>
  numberOrZero(claim.InscClaimAmtReimbursed) + numberOrZero(claim.DeductibleAmtPaid);

const normalizedAmount = (amount) =>
  Math.max(amount / AMOUNT_NORMALIZATION_DIVISOR, 0.0001);

const buildBaseHybridRecord = ({
  claim,
  beneficiary = {},
  potentialFraud = false,
  claimSetting,
  amountRange,
  previousClaimCount = 0,
  providerVelocityAnomaly = false,
  claimantVelocityAnomaly = false,
}) => {
  const sourceClaimId = clean(claim.ClaimID);
  const sourceBeneId = clean(claim.BeneID);
  const sourceProviderId = clean(claim.Provider);
  if (!sourceClaimId || !sourceBeneId || !sourceProviderId) {
    throw new Error("Hybrid source claim is missing ClaimID, BeneID, or Provider");
  }

  const startValue = clean(claim.AdmissionDt) || clean(claim.ClaimStartDt);
  const endValue = clean(claim.DischargeDt) || clean(claim.ClaimEndDt) || startValue;
  const admissionDate = normalizeDate(startValue);
  const dischargeDate = normalizeDate(endValue, clean(claim.ClaimStartDt) || "2009-01-01");
  const invoiceDate = dischargeDate;
  const invoiceNumber = `HYB-${sourceClaimId}`;
  const sourceClaimAmountUsd = getSourceClaimAmount(claim);
  const billAmount = normalizedAmount(sourceClaimAmountUsd);
  const expectedMinimum = normalizedAmount(amountRange.minimum);
  const expectedMaximum = Math.max(normalizedAmount(amountRange.maximum), expectedMinimum * 1.2);
  const providerAlias = `PRV-${sha256Hex(sourceProviderId).slice(0, 10).toUpperCase()}`;
  const claimantAlias = `CLMNT-${sha256Hex(sourceBeneId).slice(0, 10).toUpperCase()}`;
  const diagnosisCode = resolveDiagnosisCode(claim);
  const sourceProcedureCode = resolveProcedureCode(claim);

  return {
    recordId: `hybrid-${sourceClaimId}`,
    datasetProfile: HYBRID_DATASET_VERSION,
    sourceClaimId,
    sourceBeneId,
    sourceProviderId,
    baseDataOrigin: "PUBLIC_SECONDARY",
    claimSetting,
    claimantId: claimantAlias,
    patientHash: sha256Hash(`beneficiary:${sourceBeneId}`),
    familyId: "",
    providerId: providerAlias,
    hospitalId: providerAlias,
    hospitalName: `Benchmark Provider ${providerAlias.slice(-6)}`,
    division: "PUBLIC_BENCHMARK",
    district: "UNDISCLOSED",
    hospitalTier: "SECONDARY",
    licenseStatus: "ACTIVE",
    patientAgeBand: calculateAgeBand(beneficiary.DOB, startValue),
    treatmentType: claimSetting === "INPATIENT" ? "HOSPITALIZATION" : "DIAGNOSTIC",
    diagnosisCode,
    sourceProcedureCode,
    occurredAt: admissionDate,
    admissionDate,
    dischargeDate,
    invoiceDate,
    sourceClaimAmountUsd,
    billAmount: billAmount.toFixed(4),
    expectedBillMin: expectedMinimum.toFixed(4),
    expectedBillMax: expectedMaximum.toFixed(4),
    amountNormalizationVersion: AMOUNT_NORMALIZATION_VERSION,
    amountNormalizationDivisor: AMOUNT_NORMALIZATION_DIVISOR,
    invoiceNumber,
    invoiceHash: hashInvoiceNumber(invoiceNumber),
    invoiceStatus: "VALID",
    recordStatus: "VALID",
    providerPotentialFraud: Boolean(potentialFraud),
    providerLabelType: "POTENTIAL_PROVIDER_FRAUD",
    scenarioInjected: false,
    scenarioType: "NONE",
    scenarioVersion: SCENARIO_VERSION,
    fraudLabel: "LEGITIMATE",
    actualFraud: false,
    controlledAttackTruth: false,
    fraudSignals: {
      usedInvoice: false,
      cancelledRecord: false,
      inflatedAmount: false,
      blacklistedHospital: false,
      dateMismatch: false,
    },
    previousClaimCount,
    providerVelocityAnomaly,
    claimantVelocityAnomaly,
    nearDuplicateAdvisory: false,
    isMissingOrNoisy: false,
    dataQuality: "COMPLETE",
    recurringLegitimate: !potentialFraud && previousClaimCount > 0,
    beneficiaryGenderCode: clean(beneficiary.Gender),
    beneficiaryRaceCode: clean(beneficiary.Race),
    chronicConditionCount: getChronicConditionCount(beneficiary),
    syntheticSource: HYBRID_DATASET_VERSION,
    latentMechanism: {
      compromisedProvider: false,
      claimantCollusion: false,
      fraudProbability: 0,
    },
  };
};

const injectScenario = (record, { seed = DEFAULT_SEED, rate = 0.12 } = {}) => {
  if (stableUnit(`inject:${seed}:${record.sourceClaimId}`) >= rate) {
    return { ...record, fraudSignals: { ...record.fraudSignals } };
  }

  const scenarioIndex = Math.floor(
    stableUnit(`scenario:${seed}:${record.sourceClaimId}`) * CLAIM_SCENARIOS.length
  );
  const scenarioType = CLAIM_SCENARIOS[Math.min(scenarioIndex, CLAIM_SCENARIOS.length - 1)];
  const injected = {
    ...record,
    fraudSignals: { ...record.fraudSignals },
    scenarioInjected: true,
    scenarioType,
    scenarioVersion: SCENARIO_VERSION,
    actualFraud: true,
    controlledAttackTruth: true,
    syntheticSource: SCENARIO_VERSION,
  };

  switch (scenarioType) {
    case "USED_INVOICE":
      injected.invoiceStatus = "USED";
      injected.recordStatus = "USED";
      injected.fraudLabel = "USED_INVOICE";
      injected.fraudSignals.usedInvoice = true;
      injected.previousClaimCount = Math.max(2, injected.previousClaimCount);
      break;
    case "CANCELLED_RECORD":
      injected.invoiceStatus = "CANCELLED";
      injected.recordStatus = "CANCELLED";
      injected.fraudLabel = "CANCELLED_RECORD";
      injected.fraudSignals.cancelledRecord = true;
      break;
    case "INFLATED_AMOUNT": {
      const inflatedAmount = Number(injected.expectedBillMax) * 1.6;
      injected.billAmount = inflatedAmount.toFixed(4);
      injected.fraudLabel = "INFLATED_AMOUNT";
      injected.fraudSignals.inflatedAmount = true;
      break;
    }
    case "DATE_MISMATCH":
      injected.invoiceDate = addDays(injected.dischargeDate, 45);
      injected.fraudLabel = "DATE_MISMATCH";
      injected.fraudSignals.dateMismatch = true;
      break;
    case "BLACKLISTED_HOSPITAL":
      injected.licenseStatus = "BLACKLISTED";
      injected.fraudLabel = "BLACKLISTED_HOSPITAL";
      injected.fraudSignals.blacklistedHospital = true;
      break;
    case "NEAR_DUPLICATE":
      injected.nearDuplicateAdvisory = true;
      injected.fraudLabel = "SUSPICIOUS_PATTERN";
      break;
    case "PROVIDER_COMPROMISE":
      injected.providerVelocityAnomaly = true;
      injected.fraudLabel = "SUSPICIOUS_PATTERN";
      injected.latentMechanism = {
        ...injected.latentMechanism,
        compromisedProvider: true,
        fraudProbability: 1,
      };
      break;
    case "NOISY_RECORD":
      injected.invoiceStatus = "SUSPICIOUS";
      injected.isMissingOrNoisy = true;
      injected.dataQuality = "NOISY";
      injected.fraudLabel = "SUSPICIOUS_PATTERN";
      break;
    default:
      throw new Error(`Unsupported hybrid scenario: ${scenarioType}`);
  }

  return injected;
};

module.exports = {
  AMOUNT_NORMALIZATION_DIVISOR,
  AMOUNT_NORMALIZATION_VERSION,
  CLAIM_SCENARIOS,
  DEFAULT_SEED,
  HYBRID_DATASET_VERSION,
  SCENARIO_VERSION,
  buildBaseHybridRecord,
  clean,
  createDeterministicSampler,
  getProviderSplit,
  getSourceClaimAmount,
  hashInvoiceNumber,
  injectScenario,
  parseCsvLine,
  sha256Hash,
  stableUnit,
  toRow,
};
