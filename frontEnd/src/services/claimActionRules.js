export const CLAIM_ACTIONS = {
  REQUEST_ORACLE: "REQUEST_ORACLE",
  RESOLVE_ORACLE_TIMEOUT: "RESOLVE_ORACLE_TIMEOUT",
  MANUAL_REVIEW: "MANUAL_REVIEW",
  APPROVE: "APPROVE",
  REJECT: "REJECT",
  FINALIZE_VOTING: "FINALIZE_VOTING",
  AUDITOR_VOTE: "AUDITOR_VOTE",
  SETTLE: "SETTLE",
  CLOSE: "CLOSE",
  APPEAL: "APPEAL",
};

const allowedStatuses = {
  [CLAIM_ACTIONS.REQUEST_ORACLE]: ["DUPLICATE_CHECKED"],
  [CLAIM_ACTIONS.RESOLVE_ORACLE_TIMEOUT]: ["ORACLE_PENDING"],
  [CLAIM_ACTIONS.MANUAL_REVIEW]: ["FRAUD_FLAGGED", "ORACLE_FAILED"],
  [CLAIM_ACTIONS.APPROVE]: ["ORACLE_VERIFIED", "MANUAL_REVIEW"],
  [CLAIM_ACTIONS.REJECT]: [
    "DUPLICATE_CHECKED",
    "ORACLE_PENDING",
    "ORACLE_VERIFIED",
    "ORACLE_FAILED",
    "MANUAL_REVIEW",
  ],
  [CLAIM_ACTIONS.FINALIZE_VOTING]: ["MANUAL_REVIEW", "ORACLE_FAILED"],
  [CLAIM_ACTIONS.AUDITOR_VOTE]: ["MANUAL_REVIEW", "ORACLE_FAILED"],
  [CLAIM_ACTIONS.SETTLE]: ["APPROVED"],
  [CLAIM_ACTIONS.CLOSE]: ["SETTLED", "REJECTED"],
  [CLAIM_ACTIONS.APPEAL]: ["REJECTED"],
};

const roleByAction = {
  [CLAIM_ACTIONS.REQUEST_ORACLE]: "ADMIN",
  [CLAIM_ACTIONS.RESOLVE_ORACLE_TIMEOUT]: "ADMIN",
  [CLAIM_ACTIONS.MANUAL_REVIEW]: "ADMIN",
  [CLAIM_ACTIONS.APPROVE]: "ADMIN",
  [CLAIM_ACTIONS.REJECT]: "ADMIN",
  [CLAIM_ACTIONS.FINALIZE_VOTING]: "ADMIN",
  [CLAIM_ACTIONS.SETTLE]: "ADMIN",
  [CLAIM_ACTIONS.CLOSE]: "ADMIN",
  [CLAIM_ACTIONS.AUDITOR_VOTE]: "AUDITOR",
};

export function getClaimActionRule({
  action,
  statusName,
  role,
  policyStatus,
  hasOnChainRole = true,
  alreadySettled = false,
  appealAlreadyUsed = false,
  insufficientReserve = false,
  oracleQuorumReached = true,
  hasVoted = false,
  auditorVotingFinalized = false,
  auditorConsensusCode = null,
  allowAdminOverride = false,
}) {
  const allowed = allowedStatuses[action] || [];

  if (!allowed.includes(statusName)) {
    return { allowed: false, reason: `Wrong status: ${statusName || "UNKNOWN"}` };
  }

  if (roleByAction[action] && role && role !== roleByAction[action]) {
    return { allowed: false, reason: `Wrong role: ${role}` };
  }

  if (!hasOnChainRole) {
    return { allowed: false, reason: "Missing on-chain role" };
  }

  if (policyStatus && policyStatus !== "ACTIVE") {
    return {
      allowed: false,
      reason:
        policyStatus === "GRACE_PERIOD" || policyStatus === "LAPSED"
          ? "Premium overdue"
          : "Policy inactive",
    };
  }

  if (alreadySettled) return { allowed: false, reason: "Already settled" };
  if (appealAlreadyUsed) return { allowed: false, reason: "Appeal already used" };
  if (insufficientReserve) return { allowed: false, reason: "Insufficient reserve" };
  if (!oracleQuorumReached) return { allowed: false, reason: "Oracle quorum not reached" };
  if (action === CLAIM_ACTIONS.AUDITOR_VOTE && auditorVotingFinalized) {
    return { allowed: false, reason: "Auditor voting is finalized" };
  }
  if (hasVoted) return { allowed: false, reason: "Already voted" };
  if (
    ["APPROVE", "REJECT"].includes(action) &&
    statusName === "MANUAL_REVIEW" &&
    !auditorVotingFinalized &&
    !allowAdminOverride
  ) {
    return {
      allowed: false,
      reason: "Finalize the required auditor quorum before deciding this claim",
    };
  }
  if (
    action === CLAIM_ACTIONS.APPROVE &&
    statusName === "MANUAL_REVIEW" &&
    auditorConsensusCode &&
    Number(auditorConsensusCode) !== 1 &&
    !allowAdminOverride
  ) {
    return { allowed: false, reason: "Auditor consensus is not Valid Claim" };
  }
  if (
    action === CLAIM_ACTIONS.REJECT &&
    statusName === "MANUAL_REVIEW" &&
    auditorConsensusCode &&
    Number(auditorConsensusCode) !== 2 &&
    !allowAdminOverride
  ) {
    return { allowed: false, reason: "Auditor consensus is not Invalid Claim" };
  }

  return { allowed: true, reason: "" };
}
