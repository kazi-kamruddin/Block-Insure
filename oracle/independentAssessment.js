const normalizeHash = (value) => String(value || "").trim().toLowerCase();
const { extractObservedFeatures } = require("./observableFeatures");
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
    patientMatches: Boolean(claim.claimantWallet && record.authorizedClaimants?.some((wallet) => normalizeText(wallet) === normalizeText(claim.claimantWallet))),
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
  };
};

const extractProofBoundFeatures = ({ record, comparison }) => {
  return extractObservedFeatures({ record, comparison });
};

const independentlyAssessRecord = ({ record, claim, modelArtifact, triagePolicy }) => {
  const comparison = compareCommittedRecord({ record, claim });
  const features = extractProofBoundFeatures({ record, comparison });
  const hardComparisonPassed = [
    "patientMatches",
    "hospitalId",
    "invoiceHash",
    "billAmount",
    "recordStatus",
    "invoiceStatus",
    "licenseStatus",
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
