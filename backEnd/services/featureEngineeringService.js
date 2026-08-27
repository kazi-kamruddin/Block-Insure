const FEATURE_SCHEMA_VERSION = "fraud-features-v3";

const FEATURE_NAMES = [
  "clean_registry_match",
  "registry_record_missing",
  "hospital_id_mismatch",
  "invoice_hash_mismatch",
  "claim_exceeds_registry_bill",
  "bill_range_anomaly",
  "treatment_type_mismatch",
  "date_mismatch",
  "invalid_record_status",
  "used_invoice",
  "cancelled_record",
  "license_suspended",
  "license_blacklisted",
  "repeat_claim_pattern",
  "provider_velocity_anomaly",
  "claimant_velocity_anomaly",
  "near_duplicate_advisory",
  "missing_or_noisy_record",
];

const numberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const failed = (comparison, field) =>
  comparison?.fieldChecks?.[field]?.matched === false;

const extractRecordFeatures = (record) => {
  const amount = numberOrNull(record?.billAmount);
  const minimum = numberOrNull(record?.expectedBillMin);
  const maximum = numberOrNull(record?.expectedBillMax);
  const billRangeAnomaly =
    amount !== null && minimum !== null && maximum !== null
      ? amount < minimum * 0.85 || amount > maximum * 1.15
      : false;
  const invalidRecord = Boolean(record && record.recordStatus !== "VALID");
  const usedInvoice = Boolean(
    record?.invoiceStatus === "USED" ||
    record?.recordStatus === "USED" ||
    record?.fraudSignals?.usedInvoice
  );
  const cancelledRecord = Boolean(
    record?.invoiceStatus === "CANCELLED" ||
    record?.recordStatus === "CANCELLED" ||
    record?.fraudSignals?.cancelledRecord
  );
  const licenseBlacklisted = Boolean(
    record?.licenseStatus === "BLACKLISTED" ||
    record?.fraudSignals?.blacklistedHospital
  );
  const dateMismatch = Boolean(record?.fraudSignals?.dateMismatch);
  const inflated = Boolean(record?.fraudSignals?.inflatedAmount || billRangeAnomaly);
  const repeat = (numberOrNull(record?.previousClaimCount) || 0) >= 2;
  const missingOrNoisy = Boolean(record?.isMissingOrNoisy || record?.dataQuality === "NOISY");
  const activeSignals = [
    inflated,
    dateMismatch,
    invalidRecord,
    usedInvoice,
    cancelledRecord,
    record?.licenseStatus === "SUSPENDED",
    licenseBlacklisted,
    repeat,
    record?.providerVelocityAnomaly,
    record?.claimantVelocityAnomaly,
    record?.nearDuplicateAdvisory,
    missingOrNoisy,
  ].some(Boolean);

  return {
    clean_registry_match: Boolean(record) && !activeSignals,
    registry_record_missing: !record,
    hospital_id_mismatch: Boolean(record?.hospitalIdMismatch),
    invoice_hash_mismatch: Boolean(record?.invoiceHashMismatch),
    claim_exceeds_registry_bill: inflated,
    bill_range_anomaly: billRangeAnomaly,
    treatment_type_mismatch: Boolean(record?.treatmentTypeMismatch),
    date_mismatch: dateMismatch,
    invalid_record_status: invalidRecord,
    used_invoice: usedInvoice,
    cancelled_record: cancelledRecord,
    license_suspended: record?.licenseStatus === "SUSPENDED",
    license_blacklisted: licenseBlacklisted,
    repeat_claim_pattern: repeat,
    provider_velocity_anomaly: Boolean(record?.providerVelocityAnomaly),
    claimant_velocity_anomaly: Boolean(record?.claimantVelocityAnomaly),
    near_duplicate_advisory: Boolean(record?.nearDuplicateAdvisory),
    missing_or_noisy_record: missingOrNoisy,
  };
};

const extractRuntimeFeatures = ({ record, comparison, duplicateIntelligence }) => {
  const features = extractRecordFeatures(record);
  features.registry_record_missing = !record;
  features.hospital_id_mismatch = failed(comparison, "hospitalId");
  features.invoice_hash_mismatch = failed(comparison, "invoiceHash");
  features.claim_exceeds_registry_bill =
    failed(comparison, "billAmount") || features.claim_exceeds_registry_bill;
  features.treatment_type_mismatch = failed(comparison, "treatmentType");
  features.date_mismatch =
    failed(comparison, "dateConsistency") || features.date_mismatch;
  features.near_duplicate_advisory = Boolean(
    duplicateIntelligence?.requiresManualReview || features.near_duplicate_advisory
  );
  features.clean_registry_match = Boolean(record) && !Object.entries(features).some(
    ([name, active]) => name !== "clean_registry_match" && active
  );
  return features;
};

module.exports = {
  FEATURE_NAMES,
  FEATURE_SCHEMA_VERSION,
  extractRecordFeatures,
  extractRuntimeFeatures,
};
