import { getStatusLabel } from "../services/contractService";

export const CLAIM_STATUS_EXPLANATIONS = {
  SUBMITTED: "Claim was submitted on-chain and is waiting for duplicate checks.",
  DUPLICATE_CHECKED:
    "Claim passed duplicate checks and is ready for oracle verification.",
  FRAUD_FLAGGED:
    "Claim was flagged by duplicate/fraud checks and should go to manual review.",
  ORACLE_PENDING:
    "Oracle verification has been requested and the oracle worker should process it.",
  ORACLE_VERIFIED:
    "Oracle verification completed; payout allocation is automatic in the same transaction.",
  ORACLE_FAILED:
    "Oracle could not verify the hospital record. Manual review becomes publicly routable after the SLA.",
  MANUAL_REVIEW:
    "Four snapshotted auditors are reviewing the claim. Quorum finalizes automatically.",
  PAYOUT_READY: "The payout is allocated and ready for claimant withdrawal.",
  FUNDING_REQUIRED: "The claim is valid but treasury funding is required before withdrawal.",
  APPEALED: "An appeal opened a new claim version and oracle cycle.",
  REJECTED: "Claim was rejected and cannot be settled.",
  SETTLED: "The claimant withdrew the allocated settlement.",
  CLOSED: "Claim lifecycle is closed.",
  UNKNOWN: "Status could not be resolved from the returned contract/API value.",
};

export function normalizeStatus(status) {
  if (status === undefined || status === null) return "UNKNOWN";

  if (typeof status === "object") {
    if (status.label) return status.label;
    if (status.name) return status.name;
    if (status.statusLabel) return status.statusLabel;
    if (status.statusName) return status.statusName;
    if (status.code !== undefined) return getStatusLabel(status.code);
    if (status.value !== undefined) return getStatusLabel(status.value);
    if (status._hex) return getStatusLabel(Number(status._hex));
    return "UNKNOWN";
  }

  if (typeof status === "number") return getStatusLabel(status);

  if (!Number.isNaN(Number(status))) {
    return getStatusLabel(Number(status));
  }

  return String(status);
}

export function getClaimStatusName(claim) {
  return normalizeStatus(
    claim?.statusLabel || claim?.statusName || claim?.statusCode || claim?.status
  );
}

export function getStatusExplanation(status) {
  const statusName = normalizeStatus(status);
  return CLAIM_STATUS_EXPLANATIONS[statusName] || CLAIM_STATUS_EXPLANATIONS.UNKNOWN;
}
