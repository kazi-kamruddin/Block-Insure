const normalizeHash = (value) => String(value || "").trim().toLowerCase();
const normalizeText = (value) => String(value || "").trim().toLowerCase();
const numberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const clamp = (value) => Math.min(1 - 1e-12, Math.max(1e-12, Number(value)));

const predictBernoulli = (model, features) => {
  const scores = {
    fraud: Math.log(clamp(model.classPrior.fraud)),
    legitimate: Math.log(clamp(model.classPrior.legitimate)),
  };
  for (const name of model.featureNames) {
    const state = features[name] ? "present" : "absent";
    scores.fraud += Math.log(clamp(model.featureProbabilities[name].fraud[state]));
    scores.legitimate += Math.log(clamp(model.featureProbabilities[name].legitimate[state]));
  }
  const maximum = Math.max(scores.fraud, scores.legitimate);
  const denominator = Math.exp(scores.fraud - maximum) + Math.exp(scores.legitimate - maximum);
  return Math.exp(scores.fraud - maximum) / denominator;
};

const calibrate = (probability, calibration) => {
  if (!calibration || calibration.method === "none") return probability;
  if (calibration.method === "platt") {
    const bounded = Math.min(1 - 1e-9, Math.max(1e-9, probability));
    const logit = Math.log(bounded / (1 - bounded));
    return 1 / (1 + Math.exp(-(calibration.slope * logit + calibration.intercept)));
  }
  if (calibration.method === "isotonic") {
    return (
      calibration.blocks.find((block) => probability <= block.max) ||
      calibration.blocks.at(-1)
    )?.value ?? probability;
  }
  throw new Error(`Unsupported oracle calibration: ${calibration.method}`);
};

const compareCommittedRecord = ({ record, claim }) => {
  const claimAmountEth = numberOrNull(claim.claimAmountEth);
  const registryAmount = numberOrNull(record.billAmount);
  const minimum = numberOrNull(record.expectedBillMin);
  const maximum = numberOrNull(record.expectedBillMax);
  const incidentDate = new Date(Number(claim.incidentDate) * 1000);
  const admissionDate = new Date(record.admissionDate);
  const finalDate = new Date(record.invoiceDate || record.dischargeDate || record.admissionDate);
  const tolerance = 30 * 86_400_000;
  const dateMatched =
    Number.isFinite(incidentDate.getTime()) &&
    incidentDate >= new Date(admissionDate.getTime() - tolerance) &&
    incidentDate <= new Date(finalDate.getTime() + tolerance);

  return {
    hospitalId: normalizeText(record.hospitalId) === normalizeText(claim.hospitalId),
    invoiceHash: normalizeHash(record.invoiceHash) === normalizeHash(claim.invoiceHash),
    billAmount:
      claimAmountEth !== null && registryAmount !== null && claimAmountEth <= registryAmount,
    billRange:
      registryAmount !== null && minimum !== null && maximum !== null &&
      registryAmount >= minimum * 0.85 && registryAmount <= maximum * 1.15,
    treatmentType: normalizeText(record.treatmentType) === normalizeText(claim.claimType),
    dateConsistency: dateMatched,
    recordStatus: record.recordStatus === "VALID",
    invoiceStatus: record.invoiceStatus === "VALID",
    licenseStatus: record.licenseStatus === "ACTIVE",
    controlledLabel: record.fraudLabel === "LEGITIMATE",
  };
};

const extractProofBoundFeatures = ({ record, comparison }) => {
  const signals = record.fraudSignals || {};
  const invalidRecord = record.recordStatus !== "VALID";
  const usedInvoice = record.invoiceStatus === "USED" || record.recordStatus === "USED" || signals.usedInvoice;
  const cancelledRecord = record.invoiceStatus === "CANCELLED" || record.recordStatus === "CANCELLED" || signals.cancelledRecord;
  const billRangeAnomaly = !comparison.billRange;
  const features = {
    clean_registry_match: false,
    registry_record_missing: false,
    hospital_id_mismatch: !comparison.hospitalId,
    invoice_hash_mismatch: !comparison.invoiceHash,
    claim_exceeds_registry_bill: !comparison.billAmount || Boolean(signals.inflatedAmount) || billRangeAnomaly,
    bill_range_anomaly: billRangeAnomaly,
    treatment_type_mismatch: !comparison.treatmentType,
    date_mismatch: !comparison.dateConsistency || Boolean(signals.dateMismatch),
    invalid_record_status: invalidRecord,
    used_invoice: Boolean(usedInvoice),
    cancelled_record: Boolean(cancelledRecord),
    license_suspended: record.licenseStatus === "SUSPENDED",
    license_blacklisted: record.licenseStatus === "BLACKLISTED" || Boolean(signals.blacklistedHospital),
    repeat_claim_pattern: Number(record.previousClaimCount || 0) >= 2,
    provider_velocity_anomaly: Boolean(record.providerVelocityAnomaly),
    claimant_velocity_anomaly: Boolean(record.claimantVelocityAnomaly),
    near_duplicate_advisory: Boolean(record.nearDuplicateAdvisory),
    missing_or_noisy_record: Boolean(record.isMissingOrNoisy || record.dataQuality === "NOISY"),
  };
  features.clean_registry_match = !Object.entries(features).some(
    ([name, active]) => name !== "clean_registry_match" && active
  );
  return features;
};

const independentlyAssessRecord = ({ record, claim, modelArtifact, triagePolicy }) => {
  const comparison = compareCommittedRecord({ record, claim });
  const features = extractProofBoundFeatures({ record, comparison });
  const hardComparisonPassed = [
    "hospitalId",
    "invoiceHash",
    "billAmount",
    "recordStatus",
    "invoiceStatus",
    "licenseStatus",
    "controlledLabel",
  ].every((name) => comparison[name]);
  const rawProbability = predictBernoulli(modelArtifact, features);
  const fraudProbability = calibrate(rawProbability, modelArtifact.calibration);
  const hardFeature = triagePolicy.routing.hardBlockingFeatures.some((name) => features[name]);
  const anomalyFeature = (triagePolicy.routing.manualReviewFeatures || [])
    .some((name) => features[name]);
  const manualReview =
    anomalyFeature ||
    features.near_duplicate_advisory ||
    fraudProbability >= triagePolicy.routing.manualReviewThreshold;
  const verified = hardComparisonPassed && !hardFeature && !manualReview;
  return {
    verified,
    verificationCode: !hardComparisonPassed || hardFeature
      ? "PROOF_BOUND_INTEGRITY_REJECTED"
      : manualReview
        ? "PROOF_BOUND_MANUAL_REVIEW"
        : "VERIFIED",
    fraudProbability,
    riskLevel: fraudProbability >= 0.7 ? "HIGH" : fraudProbability >= 0.35 ? "MEDIUM" : "LOW",
    comparison,
    features,
  };
};

module.exports = {
  compareCommittedRecord,
  extractProofBoundFeatures,
  independentlyAssessRecord,
  predictBernoulli,
};
