// Dependency-free inference contract shared by the API, both workers, and
// offline experiments. Labels, scenario markers and top-level injected history
// are intentionally not read here. A model cannot recover unobservable truth.
const finite = (value) => value === null || value === undefined || value === "" ? null
  : Number.isFinite(Number(value)) ? Number(value) : null;
const extractObservedFeatures = ({ record, comparison = {} }) => {
  const failed = (name) => comparison[name] === false;
  const amount = finite(record?.billAmount);
  const minimum = finite(record?.expectedBillMin);
  const maximum = finite(record?.expectedBillMax);
  const rangeAnomaly = failed("billRange") || failed("expectedBillRange") ||
    (amount !== null && minimum !== null && maximum !== null &&
      (amount < minimum * 0.85 || amount > maximum * 1.15));
  const history = record?.observableHistory || {};
  const features = {
    clean_registry_match: false,
    registry_record_missing: !record,
    hospital_id_mismatch: failed("hospitalId"),
    invoice_hash_mismatch: failed("invoiceHash"),
    claim_exceeds_registry_bill: failed("billAmount") || rangeAnomaly,
    bill_range_anomaly: rangeAnomaly,
    treatment_type_mismatch: failed("treatmentType"),
    date_mismatch: failed("dateConsistency"),
    invalid_record_status: Boolean(record && record.recordStatus !== "VALID"),
    used_invoice: record?.invoiceStatus === "USED" || record?.recordStatus === "USED",
    cancelled_record: record?.invoiceStatus === "CANCELLED" || record?.recordStatus === "CANCELLED",
    license_suspended: record?.licenseStatus === "SUSPENDED",
    license_blacklisted: record?.licenseStatus === "BLACKLISTED",
    repeat_claim_pattern: Number(history.previousClaimCount || 0) >= 2,
    provider_velocity_anomaly: history.providerVelocityAnomaly === true,
    claimant_velocity_anomaly: history.claimantVelocityAnomaly === true,
    // Fuzzy matches are UI advice, not proof-bound protocol evidence.
    near_duplicate_advisory: false,
    missing_or_noisy_record: false,
  };
  features.clean_registry_match = Boolean(record) && !Object.entries(features).some(
    ([name, active]) => name !== "clean_registry_match" && active
  );
  return features;
};
module.exports = { extractObservedFeatures };
