const MockHospitalRecord = require("../models/MockHospitalRecord");

const MODEL_VERSION = "phase-3-bayesian-zscore-v1";
const LOW_RISK_THRESHOLD = 35;
const HIGH_RISK_THRESHOLD = 70;
const HARD_BLOCK_THRESHOLD = 85;
const ANOMALY_Z_THRESHOLD = 2;
const BILL_RANGE_TOLERANCE_RATE = 0.15;

const clampProbability = (value) => {
  return Math.min(Math.max(value, 0.001), 0.999);
};

const toNumber = (value) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

const isFraudRecord = (record) => {
  return Boolean(record && record.fraudLabel && record.fraudLabel !== "LEGITIMATE");
};

const checkFailed = (comparison, field) => {
  const check = comparison?.fieldChecks?.[field];
  return Boolean(check && check.matched === false);
};

const calculateStats = (values) => {
  const cleanValues = values.filter((value) => Number.isFinite(value));

  if (cleanValues.length === 0) {
    return {
      sampleSize: 0,
      mean: null,
      stdDev: null,
      min: null,
      max: null,
    };
  }

  const mean =
    cleanValues.reduce((total, value) => total + value, 0) / cleanValues.length;
  const variance =
    cleanValues.reduce((total, value) => total + (value - mean) ** 2, 0) /
    cleanValues.length;
  const stdDev = Math.sqrt(variance);

  return {
    sampleSize: cleanValues.length,
    mean,
    stdDev,
    min: Math.min(...cleanValues),
    max: Math.max(...cleanValues),
  };
};

const round = (value, decimals = 4) => {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(decimals));
};

const getZScore = (value, stats) => {
  if (!Number.isFinite(value) || !stats?.sampleSize || !Number.isFinite(stats.mean)) {
    return null;
  }

  if (!stats.stdDev || stats.stdDev < 0.000001) {
    return value === stats.mean ? 0 : ANOMALY_Z_THRESHOLD + 1;
  }

  return (value - stats.mean) / stats.stdDev;
};

const getDatasetStats = (records) => {
  const totalRecords = records.length;
  const fraudRecords = records.filter(isFraudRecord).length;
  const legitimateRecords = totalRecords - fraudRecords;

  return {
    totalRecords,
    fraudRecords,
    legitimateRecords,
    priorFraudProbability: totalRecords
      ? fraudRecords / totalRecords
      : 0.2,
    smoothing: "Laplace +1",
  };
};

const getLikelihood = ({ records, datasetStats, predicate, fallback }) => {
  if (!predicate || records.length === 0) {
    return fallback;
  }

  const fraudRecords = records.filter(isFraudRecord);
  const legitimateRecords = records.filter((record) => !isFraudRecord(record));
  const fraudMatches = fraudRecords.filter(predicate).length;
  const legitimateMatches = legitimateRecords.filter(predicate).length;

  return {
    fraud: (fraudMatches + 1) / (datasetStats.fraudRecords + 2),
    legitimate: (legitimateMatches + 1) / (datasetStats.legitimateRecords + 2),
  };
};

const isBillRangeOutlier = (record) => {
  const billAmount = toNumber(record?.billAmount);
  const expectedBillMin = toNumber(record?.expectedBillMin);
  const expectedBillMax = toNumber(record?.expectedBillMax);

  if (
    billAmount === null ||
    expectedBillMin === null ||
    expectedBillMax === null
  ) {
    return false;
  }

  return (
    billAmount < expectedBillMin * (1 - BILL_RANGE_TOLERANCE_RATE) ||
    billAmount > expectedBillMax * (1 + BILL_RANGE_TOLERANCE_RATE)
  );
};

const buildAnomalySignals = ({ records, record, query }) => {
  const treatmentType = record?.treatmentType || query?.claimType || "";
  const claimAmount = toNumber(query?.claimAmountEth);
  const registryAmount = toNumber(record?.billAmount);
  const amountForScoring = claimAmount ?? registryAmount;
  const legitimateRecords = records.filter((item) => !isFraudRecord(item));
  const sameTreatmentRecords = legitimateRecords.filter(
    (item) => item.treatmentType === treatmentType
  );
  const amountPopulation =
    sameTreatmentRecords.length >= 3 ? sameTreatmentRecords : legitimateRecords;
  const amountStats = calculateStats(
    amountPopulation.map((item) => toNumber(item.billAmount))
  );
  const amountZScore = getZScore(amountForScoring, amountStats);
  const previousClaimCount = toNumber(record?.previousClaimCount) ?? 0;
  const repeatClaimStats = calculateStats(
    records.map((item) => toNumber(item.previousClaimCount) ?? 0)
  );
  const repeatClaimZScore = getZScore(previousClaimCount, repeatClaimStats);

  return {
    amountZScore: {
      metric: "claim_amount_by_treatment_type",
      treatmentType: treatmentType || null,
      value: round(amountForScoring),
      mean: round(amountStats.mean),
      stdDev: round(amountStats.stdDev),
      zScore: round(amountZScore),
      threshold: ANOMALY_Z_THRESHOLD,
      sampleSize: amountStats.sampleSize,
      isAnomaly:
        amountZScore !== null && Math.abs(amountZScore) >= ANOMALY_Z_THRESHOLD,
    },
    repeatClaimZScore: {
      metric: "previous_claim_count",
      value: previousClaimCount,
      mean: round(repeatClaimStats.mean),
      stdDev: round(repeatClaimStats.stdDev),
      zScore: round(repeatClaimZScore),
      threshold: ANOMALY_Z_THRESHOLD,
      sampleSize: repeatClaimStats.sampleSize,
      isAnomaly:
        repeatClaimZScore !== null &&
        repeatClaimZScore >= ANOMALY_Z_THRESHOLD,
    },
  };
};

const buildEvidenceFactors = ({ record, comparison, anomalySignals }) => {
  return [
    {
      key: "clean_registry_match",
      label: "Clean registry match",
      active:
        Boolean(record) &&
        comparison?.blockingFailureCount === 0 &&
        comparison?.warningFailureCount === 0 &&
        !isFraudRecord(record),
      likelihood: { fraud: 0.04, legitimate: 0.96 },
      source: "fixed",
    },
    {
      key: "registry_record_missing",
      label: "Registry record missing",
      active: !record,
      likelihood: { fraud: 0.98, legitimate: 0.02 },
      source: "fixed",
    },
    {
      key: "hospital_id_mismatch",
      label: "Hospital ID mismatch",
      active: checkFailed(comparison, "hospitalId"),
      likelihood: { fraud: 0.92, legitimate: 0.04 },
      source: "fixed",
    },
    {
      key: "invoice_hash_mismatch",
      label: "Invoice hash mismatch",
      active: checkFailed(comparison, "invoiceHash"),
      likelihood: { fraud: 0.95, legitimate: 0.03 },
      source: "fixed",
    },
    {
      key: "claim_exceeds_registry_bill",
      label: "Claim amount exceeds registry bill",
      active: checkFailed(comparison, "billAmount"),
      likelihood: { fraud: 0.88, legitimate: 0.06 },
      source: "fixed",
    },
    {
      key: "bill_range_anomaly",
      label: "Bill amount outside treatment range",
      active:
        checkFailed(comparison, "expectedBillRange") ||
        anomalySignals.amountZScore.isAnomaly,
      predicate: isBillRangeOutlier,
      fallback: { fraud: 0.7, legitimate: 0.12 },
      source: "synthetic_registry",
    },
    {
      key: "treatment_type_mismatch",
      label: "Treatment type mismatch",
      active: checkFailed(comparison, "treatmentType"),
      likelihood: { fraud: 0.78, legitimate: 0.07 },
      source: "fixed",
    },
    {
      key: "date_mismatch",
      label: "Treatment date mismatch",
      active:
        checkFailed(comparison, "dateConsistency") ||
        record?.fraudSignals?.dateMismatch ||
        record?.fraudLabel === "DATE_MISMATCH",
      predicate: (item) =>
        item.fraudSignals?.dateMismatch || item.fraudLabel === "DATE_MISMATCH",
      fallback: { fraud: 0.55, legitimate: 0.08 },
      source: "synthetic_registry",
    },
    {
      key: "invalid_record_status",
      label: "Invalid registry status",
      active: record ? record.recordStatus !== "VALID" : true,
      predicate: (item) => item.recordStatus !== "VALID",
      fallback: { fraud: 0.8, legitimate: 0.08 },
      source: "synthetic_registry",
    },
    {
      key: "used_invoice",
      label: "Used invoice marker",
      active:
        record?.invoiceStatus === "USED" ||
        record?.recordStatus === "USED" ||
        record?.fraudSignals?.usedInvoice,
      predicate: (item) =>
        item.invoiceStatus === "USED" ||
        item.recordStatus === "USED" ||
        item.fraudSignals?.usedInvoice,
      fallback: { fraud: 0.65, legitimate: 0.05 },
      source: "synthetic_registry",
    },
    {
      key: "cancelled_record",
      label: "Cancelled record marker",
      active:
        record?.invoiceStatus === "CANCELLED" ||
        record?.recordStatus === "CANCELLED" ||
        record?.fraudSignals?.cancelledRecord,
      predicate: (item) =>
        item.invoiceStatus === "CANCELLED" ||
        item.recordStatus === "CANCELLED" ||
        item.fraudSignals?.cancelledRecord,
      fallback: { fraud: 0.62, legitimate: 0.05 },
      source: "synthetic_registry",
    },
    {
      key: "license_suspended",
      label: "Suspended hospital license",
      active: record?.licenseStatus === "SUSPENDED",
      predicate: (item) => item.licenseStatus === "SUSPENDED",
      fallback: { fraud: 0.5, legitimate: 0.1 },
      source: "synthetic_registry",
    },
    {
      key: "license_blacklisted",
      label: "Blacklisted hospital license",
      active:
        record?.licenseStatus === "BLACKLISTED" ||
        record?.fraudSignals?.blacklistedHospital,
      predicate: (item) =>
        item.licenseStatus === "BLACKLISTED" ||
        item.fraudSignals?.blacklistedHospital,
      fallback: { fraud: 0.75, legitimate: 0.04 },
      source: "synthetic_registry",
    },
    {
      key: "fraud_label_present",
      label: "Synthetic fraud label present",
      active: record ? isFraudRecord(record) : true,
      predicate: isFraudRecord,
      fallback: { fraud: 0.95, legitimate: 0.05 },
      source: "synthetic_registry",
    },
    {
      key: "repeat_claim_pattern",
      label: "Repeated-claim pattern",
      active:
        (toNumber(record?.previousClaimCount) ?? 0) >= 2 ||
        anomalySignals.repeatClaimZScore.isAnomaly,
      predicate: (item) => (toNumber(item.previousClaimCount) ?? 0) >= 2,
      fallback: { fraud: 0.52, legitimate: 0.12 },
      source: "synthetic_registry",
    },
  ];
};

const getRiskLevel = (riskScore) => {
  if (riskScore >= HIGH_RISK_THRESHOLD) return "HIGH";
  if (riskScore >= LOW_RISK_THRESHOLD) return "MEDIUM";
  return "LOW";
};

const getRecommendation = ({ riskScore, comparison, hasAnomaly }) => {
  if (
    comparison?.blockingFailureCount > 0 ||
    riskScore >= HARD_BLOCK_THRESHOLD
  ) {
    return "REJECT_ORACLE_VERIFICATION";
  }

  if (
    riskScore >= LOW_RISK_THRESHOLD ||
    comparison?.warningFailureCount > 0 ||
    hasAnomaly
  ) {
    return "MANUAL_REVIEW_RECOMMENDED";
  }

  return "AUTO_VERIFY_RECOMMENDED";
};

const buildRiskAssessment = async ({ record, comparison, query }) => {
  const records = await MockHospitalRecord.find()
    .select(
      "billAmount expectedBillMin expectedBillMax treatmentType recordStatus invoiceStatus licenseStatus fraudLabel fraudSignals previousClaimCount"
    )
    .lean();
  const datasetStats = getDatasetStats(records);
  const anomalySignals = buildAnomalySignals({ records, record, query });
  const factors = buildEvidenceFactors({
    record,
    comparison,
    anomalySignals,
  });
  let fraudLog = Math.log(clampProbability(datasetStats.priorFraudProbability));
  let legitimateLog = Math.log(
    clampProbability(1 - datasetStats.priorFraudProbability)
  );
  const evidence = factors.map((factor) => {
    const likelihood = factor.predicate
      ? getLikelihood({
          records,
          datasetStats,
          predicate: factor.predicate,
          fallback: factor.fallback,
        })
      : factor.likelihood;
    const active = Boolean(factor.active);
    const fraudLikelihood = clampProbability(active ? likelihood.fraud : 1);
    const legitimateLikelihood = clampProbability(
      active ? likelihood.legitimate : 1
    );
    const logLikelihoodRatio = Math.log(
      fraudLikelihood / legitimateLikelihood
    );

    fraudLog += Math.log(fraudLikelihood);
    legitimateLog += Math.log(legitimateLikelihood);

    return {
      key: factor.key,
      label: factor.label,
      active,
      source: factor.source,
      likelihoodGivenFraud: round(likelihood.fraud),
      likelihoodGivenLegitimate: round(likelihood.legitimate),
      appliedFraudLikelihood: round(fraudLikelihood),
      appliedLegitimateLikelihood: round(legitimateLikelihood),
      logLikelihoodRatio: round(logLikelihoodRatio),
      direction:
        !active
          ? "not_applied"
          : logLikelihoodRatio > 0
          ? "raises_fraud_probability"
          : "lowers_fraud_probability",
    };
  });
  const maxLog = Math.max(fraudLog, legitimateLog);
  const fraudExp = Math.exp(fraudLog - maxLog);
  const legitimateExp = Math.exp(legitimateLog - maxLog);
  const posteriorFraudProbability = fraudExp / (fraudExp + legitimateExp);
  const riskScore = Math.round(posteriorFraudProbability * 100);
  const hasAnomaly = Object.values(anomalySignals).some(
    (signal) => signal.isAnomaly
  );
  const riskLevel = getRiskLevel(riskScore);
  const recommendation = getRecommendation({
    riskScore,
    comparison,
    hasAnomaly,
  });
  const activeEvidence = evidence.filter((item) => item.active);

  return {
    modelVersion: MODEL_VERSION,
    method: "Naive Bayes with Laplace-smoothed synthetic registry likelihoods and Z-score anomaly checks",
    formula:
      "P(fraud | evidence) = P(evidence | fraud) * P(fraud) / P(evidence)",
    thresholds: {
      lowRiskBelow: LOW_RISK_THRESHOLD,
      highRiskFrom: HIGH_RISK_THRESHOLD,
      hardBlockFrom: HARD_BLOCK_THRESHOLD,
      anomalyZScore: ANOMALY_Z_THRESHOLD,
    },
    dataset: {
      totalRecords: datasetStats.totalRecords,
      fraudRecords: datasetStats.fraudRecords,
      legitimateRecords: datasetStats.legitimateRecords,
      priorFraudProbability: round(datasetStats.priorFraudProbability),
      priorFraudPercent: Math.round(datasetStats.priorFraudProbability * 100),
      smoothing: datasetStats.smoothing,
    },
    posteriorFraudProbability: round(posteriorFraudProbability),
    posteriorFraudPercent: riskScore,
    riskScore,
    riskLevel,
    recommendation,
    activeEvidenceCount: activeEvidence.length,
    evidence,
    activeEvidence,
    riskDrivers: activeEvidence
      .slice()
      .sort(
        (left, right) =>
          Math.abs(right.logLikelihoodRatio) -
          Math.abs(left.logLikelihoodRatio)
      )
      .slice(0, 5),
    anomalySignals,
  };
};

module.exports = {
  buildRiskAssessment,
};
