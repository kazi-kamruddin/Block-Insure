const isFraudRecord = (record) => {
  return Boolean(record && record.fraudLabel && record.fraudLabel !== "LEGITIMATE");
};

const toNumber = (value) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

const isBillRangeOutlier = (record) => {
  const billAmount = toNumber(record?.billAmount);
  const expectedBillMin = toNumber(record?.expectedBillMin);
  const expectedBillMax = toNumber(record?.expectedBillMax);

  if (billAmount === null || expectedBillMin === null || expectedBillMax === null) {
    return false;
  }

  return billAmount < expectedBillMin * 0.85 || billAmount > expectedBillMax * 1.15;
};

const hasFraudSignal = (record) => {
  return Object.values(record.fraudSignals || {}).some(Boolean);
};

const FACTOR_PREDICATES = {
  clean_registry_match: (record) =>
    record.recordStatus === "VALID" &&
    record.invoiceStatus === "VALID" &&
    record.licenseStatus === "ACTIVE" &&
    !isBillRangeOutlier(record) &&
    !hasFraudSignal(record) &&
    (toNumber(record.previousClaimCount) ?? 0) < 2,
  registry_record_missing: () => false,
  hospital_id_mismatch: () => false,
  invoice_hash_mismatch: () => false,
  claim_exceeds_registry_bill: (record) => Boolean(record.fraudSignals?.inflatedAmount),
  bill_range_anomaly: isBillRangeOutlier,
  treatment_type_mismatch: () => false,
  date_mismatch: (record) => Boolean(record.fraudSignals?.dateMismatch),
  invalid_record_status: (record) => record.recordStatus !== "VALID",
  used_invoice: (record) =>
    record.invoiceStatus === "USED" ||
    record.recordStatus === "USED" ||
    record.fraudSignals?.usedInvoice,
  cancelled_record: (record) =>
    record.invoiceStatus === "CANCELLED" ||
    record.recordStatus === "CANCELLED" ||
    record.fraudSignals?.cancelledRecord,
  license_suspended: (record) => record.licenseStatus === "SUSPENDED",
  license_blacklisted: (record) =>
    record.licenseStatus === "BLACKLISTED" ||
    record.fraudSignals?.blacklistedHospital,
  repeat_claim_pattern: (record) => (toNumber(record.previousClaimCount) ?? 0) >= 2,
};

const round = (value, decimals = 6) => Number(value.toFixed(decimals));

const trainModelParams = (records, metadata = {}) => {
  const fraudRecords = records.filter(isFraudRecord);
  const legitimateRecords = records.filter((record) => !isFraudRecord(record));
  const totalRecords = records.length;
  const factorLikelihoods = {};

  Object.entries(FACTOR_PREDICATES).forEach(([key, predicate]) => {
    const fraudMatches = fraudRecords.filter(predicate).length;
    const legitimateMatches = legitimateRecords.filter(predicate).length;

    factorLikelihoods[key] = {
      fraud: round((fraudMatches + 1) / (fraudRecords.length + 2)),
      legitimate: round(
        (legitimateMatches + 1) / (legitimateRecords.length + 2)
      ),
      fraudMatches,
      legitimateMatches,
      smoothing: "Laplace +1",
    };
  });

  return {
    modelVersion: metadata.modelVersion || "bayesian-registry-trained-v2",
    trainedAt: metadata.trainedAt || new Date().toISOString(),
    source: metadata.source || "MockHospitalRecord",
    trainingSet: {
      totalRecords,
      fraudRecords: fraudRecords.length,
      legitimateRecords: legitimateRecords.length,
      priorFraudProbability: round(
        totalRecords > 0 ? fraudRecords.length / totalRecords : 0.2
      ),
      classDistribution: {
        fraud: fraudRecords.length,
        legitimate: legitimateRecords.length,
      },
      smoothing: "Laplace +1",
    },
    factorLikelihoods,
  };
};

module.exports = {
  FACTOR_PREDICATES,
  isFraudRecord,
  trainModelParams,
};
