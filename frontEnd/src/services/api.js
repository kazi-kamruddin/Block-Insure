import axios from "axios";
import { ethers } from "ethers";

import { getWalletContract } from "./contractService";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("blockinsure_jwt");

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      error.response?.status === 401 &&
      localStorage.getItem("blockinsure_jwt")
    ) {
      clearStoredSession();
      window.dispatchEvent(
        new CustomEvent("blockinsure:session-expired", {
          detail:
            error.response?.data?.message ||
            "Your session expired. Connect your wallet again.",
        })
      );
    }

    return Promise.reject(error);
  }
);

export async function getWalletNonce(walletAddress) {
  const response = await api.get(`/api/auth/nonce/${walletAddress}`);
  return response.data;
}

export async function loginWithWallet(walletAddress, signature) {
  const response = await api.post("/api/auth/wallet-login", {
    walletAddress,
    signature,
  });

  return response.data;
}

export async function getCurrentUser() {
  const response = await api.get("/api/users/me");
  return response.data;
}

export async function getPolicyPackages() {
  const response = await api.get("/api/policy-packages");
  return response.data;
}

export async function getRiskPremiumQuote(packageId, payload) {
  const response = await api.post(
    `/api/policy-packages/${packageId}/risk-premium-quote`,
    payload
  );
  return response.data;
}

export async function createPolicyPackage(payload) {
  const response = await api.post("/api/admin/policy-packages", payload);
  return response.data;
}

export async function logoutSession() {
  const response = await api.post("/api/auth/logout");
  return response.data;
}

export async function getAdminPolicyPackages() {
  const response = await api.get("/api/admin/policy-packages");
  return response.data;
}

export async function updatePolicyPackage(packageId, payload) {
  const response = await api.put(`/api/admin/policy-packages/${packageId}`, payload);
  return response.data;
}

export async function deactivatePolicyPackage(packageId) {
  const response = await api.post(
    `/api/admin/policy-packages/${packageId}/deactivate`
  );
  return response.data;
}

export async function reactivatePolicyPackage(packageId) {
  const response = await api.post(
    `/api/admin/policy-packages/${packageId}/reactivate`
  );
  return response.data;
}

export async function getMyPolicies() {
  const response = await api.get("/api/policies/my");
  return response.data;
}

export async function uploadClaimDocument({
  file,
  documentType,
  claimId,
  attemptId,
  encryption,
}) {
  const formData = new FormData();

  formData.append("document", file);

  if (documentType) {
    formData.append("documentType", documentType);
  }

  if (claimId) {
    formData.append("claimId", claimId);
  }

  if (attemptId) {
    formData.append("attemptId", attemptId);
  }

  if (encryption?.enabled) {
    formData.append("encrypted", "true");
    formData.append("encryptionAlgorithm", encryption.algorithm);
    formData.append("originalMimeType", encryption.originalMimeType);
  }

  const response = await api.post("/api/documents/upload", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

  return response.data;
}

export async function getMyClaims() {
  const response = await api.get("/api/claims/my");
  return response.data;
}

export async function getAllReadableClaims() {
  const response = await api.get("/api/claims/all");
  return response.data;
}

export async function getClaimById(claimId) {
  const response = await api.get(`/api/claims/${claimId}`);
  return response.data;
}

export async function authorizeClaimSubmission(policyId) {
  const response = await api.post("/api/claims/submission-check", { policyId });
  return response.data;
}

export async function recordClaimSubmissionTransaction(attemptId, transactionHash) {
  const response = await api.patch(
    `/api/claims/submission-attempts/${attemptId}/transaction`,
    { transactionHash }
  );
  return response.data;
}

export async function reconcileClaimSubmission(attemptId) {
  const response = await api.post(
    `/api/claims/submission-attempts/${attemptId}/reconcile`
  );
  return response.data;
}

export async function abandonClaimSubmission(attemptId, reason = "") {
  const response = await api.delete(
    `/api/claims/submission-attempts/${attemptId}`,
    { data: { reason } }
  );
  return response.data;
}

export async function reconcilePendingClaimSubmissions() {
  const pendingKey = "block-insure:pending-claim-submissions";
  const pending = JSON.parse(localStorage.getItem(pendingKey) || "[]");
  const remaining = [];
  let reconciled = 0;

  for (const item of pending) {
    try {
      await recordClaimSubmissionTransaction(item.attemptId, item.transactionHash);
      await reconcileClaimSubmission(item.attemptId);
      reconciled += 1;
    } catch {
      remaining.push(item);
    }
  }

  localStorage.setItem(pendingKey, JSON.stringify(remaining));
  return { reconciled, remaining: remaining.length };
}

export async function getClaimDocumentHash(claimId) {
  const response = await api.get(`/api/claims/${claimId}/document-hash`);
  return response.data;
}

export async function getNotifications() {
  const response = await api.get("/api/notifications");
  return response.data;
}

export async function markNotificationRead(notificationId) {
  const response = await api.patch(`/api/notifications/${notificationId}/read`);
  return response.data;
}

export async function markAllNotificationsRead() {
  const response = await api.patch("/api/notifications/read-all");
  return response.data;
}

export async function submitAppeal(payload) {
  const response = await api.post("/api/appeals", payload);
  return response.data;
}

export async function getAppealByClaim(claimId) {
  const response = await api.get(`/api/appeals/claim/${claimId}`);
  return response.data;
}

export async function reviewAppeal(appealId, payload) {
  const normalizedStatus = String(payload.status || "").toUpperCase();

  if (!["APPROVED", "REJECTED"].includes(normalizedStatus)) {
    const response = await api.patch(`/api/appeals/${appealId}/review`, payload);
    return response.data;
  }

  const pendingKey = "block-insure:pending-appeal-decisions";
  const pending = JSON.parse(localStorage.getItem(pendingKey) || "[]");
  let decision = pending.find(
    (item) => item.appealId === appealId && item.status === normalizedStatus
  );

  if (!decision) {
    const contract = await getWalletContract();
    const tx =
      normalizedStatus === "APPROVED"
        ? await contract.reopenClaimAfterAppeal(payload.claimId)
        : await contract.finalizeRejectedAppeal(payload.claimId);

    await tx.wait();
    decision = {
      appealId,
      claimId: String(payload.claimId),
      status: normalizedStatus,
      transactionHash: tx.hash,
    };
    localStorage.setItem(
      pendingKey,
      JSON.stringify([
        ...pending.filter((item) => item.appealId !== appealId),
        decision,
      ])
    );
  }

  const response = await api.patch(`/api/appeals/${appealId}/review`, {
    ...payload,
    transactionHash: decision.transactionHash,
  });
  const remaining = JSON.parse(localStorage.getItem(pendingKey) || "[]").filter(
    (item) => item.appealId !== appealId
  );
  localStorage.setItem(pendingKey, JSON.stringify(remaining));
  return response.data;
}

export async function getClaimVoteSummary(claimId, voterAddress = "") {
  const response = await api.get(`/api/votes/claim/${claimId}`, {
    params: voterAddress ? { voterAddress } : undefined,
  });
  return response.data;
}

export async function finalizeClaimVoting(claimId) {
  const response = await api.post(`/api/votes/finalize/${claimId}`);
  return response.data;
}

export async function getAdminClaims() {
  const response = await api.get("/api/admin/claims");
  return response.data;
}

export async function getAdminActionLogs(params = {}) {
  const response = await api.get("/api/admin/audit-logs", { params });
  return response.data;
}

export async function getAdminRoleSyncHealth() {
  const response = await api.get("/api/admin/role-sync-health");
  return response.data;
}

export async function getReserveIntelligence() {
  const response = await api.get("/api/admin/reserve-intelligence");
  return response.data;
}

export async function getEvaluationSummary() {
  const response = await api.get("/api/admin/evaluation/summary");
  return response.data;
}

export async function getDefenseSummary() {
  const response = await api.get("/api/admin/evaluation/defense-summary");
  return response.data;
}

export async function getGasComparison() {
  const response = await api.get("/api/admin/evaluation/gas-comparison");
  return response.data;
}

export async function getRiskDistribution() {
  const response = await api.get("/api/admin/evaluation/risk-distribution");
  return response.data;
}

export async function getOracleStats() {
  const response = await api.get("/api/admin/evaluation/oracle-stats");
  return response.data;
}

export async function getThroughputResults() {
  const response = await api.get("/api/admin/evaluation/throughput");
  return response.data;
}

export async function getAuditorReputationAnalysis() {
  const response = await api.get("/api/admin/evaluation/auditor-reputation");
  return response.data;
}

async function executeAdminWalletAction(action, claimId, sendTransaction) {
  const tx = await sendTransaction();
  await tx.wait();

  const pendingKey = "block-insure:pending-admin-confirmations";
  const pending = JSON.parse(localStorage.getItem(pendingKey) || "[]");
  const confirmation = {
    action,
    claimId: String(claimId),
    transactionHash: tx.hash,
  };

  localStorage.setItem(
    pendingKey,
    JSON.stringify([
      ...pending.filter((item) => item.transactionHash !== tx.hash),
      confirmation,
    ])
  );

  try {
    const response = await api.post(
      `/api/admin/claims/${claimId}/confirm-transaction`,
      {
        action,
        transactionHash: tx.hash,
      }
    );
    const remaining = JSON.parse(localStorage.getItem(pendingKey) || "[]").filter(
      (item) => item.transactionHash !== tx.hash
    );
    localStorage.setItem(pendingKey, JSON.stringify(remaining));
    return response.data;
  } catch (error) {
    error.adminTransactionHash = tx.hash;
    error.message =
      `The on-chain action succeeded (${tx.hash}), but backend audit confirmation is pending. ` +
      (error.message || "");
    throw error;
  }
}

export async function reconcilePendingAdminTransactions() {
  const pendingKey = "block-insure:pending-admin-confirmations";
  const pending = JSON.parse(localStorage.getItem(pendingKey) || "[]");
  const remaining = [];
  let confirmed = 0;

  for (const item of pending) {
    try {
      await api.post(`/api/admin/claims/${item.claimId}/confirm-transaction`, {
        action: item.action,
        transactionHash: item.transactionHash,
      });
      confirmed += 1;
    } catch {
      remaining.push(item);
    }
  }

  localStorage.setItem(pendingKey, JSON.stringify(remaining));
  return { confirmed, remaining: remaining.length };
}

export async function requestOracleVerification(claimId) {
  const contract = await getWalletContract();
  return executeAdminWalletAction(
    "REQUEST_ORACLE_VERIFICATION",
    claimId,
    () => contract.requestOracleVerification(claimId)
  );
}

export async function sendClaimToManualReview(claimId) {
  const contract = await getWalletContract();
  return executeAdminWalletAction(
    "SEND_CLAIM_TO_MANUAL_REVIEW",
    claimId,
    () => contract.sendToManualReview(claimId)
  );
}

export async function approveClaim(claimId) {
  const contract = await getWalletContract();
  return executeAdminWalletAction(
    "APPROVE_CLAIM",
    claimId,
    () => contract.approveClaim(claimId)
  );
}

export async function rejectClaim(claimId, reason) {
  const contract = await getWalletContract();
  const reasonHash = ethers.keccak256(ethers.toUtf8Bytes(reason));
  return executeAdminWalletAction(
    "REJECT_CLAIM",
    claimId,
    () => contract.rejectClaim(claimId, reasonHash)
  );
}

export async function settleClaim(claimId) {
  const contract = await getWalletContract();
  return executeAdminWalletAction(
    "SETTLE_CLAIM",
    claimId,
    () => contract.settleClaim(claimId)
  );
}

export async function approveHighValueSettlement(claimId) {
  const contract = await getWalletContract();
  return executeAdminWalletAction(
    "APPROVE_HIGH_VALUE_SETTLEMENT",
    claimId,
    () => contract.approveHighValueSettlement(claimId)
  );
}

export async function resolveOracleTimeout(claimId) {
  const contract = await getWalletContract();
  return executeAdminWalletAction(
    "RESOLVE_ORACLE_TIMEOUT",
    claimId,
    () => contract.resolveTimedOutOracle(claimId)
  );
}

export async function closeClaim(claimId) {
  const contract = await getWalletContract();
  return executeAdminWalletAction(
    "CLOSE_CLAIM",
    claimId,
    () => contract.closeClaim(claimId)
  );
}

export async function getOracleResults(claimId) {
  const response = await api.get(`/api/oracle/results/${claimId}`);
  return response.data;
}

export async function getOracleHealth() {
  const response = await api.get("/api/oracle/health");
  return response.data;
}

export async function getHealthcareRegistryRecords(params = {}) {
  const response = await api.get("/mock/hospital/records", {
    params,
  });
  return response.data;
}

export async function getHealthcareRegistrySummary(params = {}) {
  const response = await api.get("/mock/hospital/records/summary", {
    params,
  });
  return response.data;
}

export async function getHealthcareRegistryMerkleRoot() {
  const response = await api.get("/mock/hospital/records/merkle-root");
  return response.data;
}

export async function getHealthcareOnChainRegistryMerkleRoot() {
  const response = await api.get("/mock/hospital/records/on-chain-merkle-root");
  return response.data;
}

export async function getOnChainRegistryMerkleRoot() {
  const response = await api.get("/api/admin/registry/merkle-root");
  return response.data;
}

export async function pushRegistryMerkleRoot() {
  const response = await api.post("/api/admin/registry/push-merkle-root");
  return response.data;
}

export async function getHealthcareRegistryMerkleProof(invoiceHash) {
  const response = await api.get("/mock/hospital/records/merkle-proof", {
    params: {
      invoiceHash,
    },
  });
  return response.data;
}

export async function getClaimAuditTimeline(claimId) {
  const response = await api.get(`/api/audit/claims/${claimId}`);
  return response.data;
}

export async function exportClaimAuditTimeline(claimId, format = "json") {
  const response = await api.get(`/api/audit/claims/${claimId}/export`, {
    params: { format },
    responseType: format === "markdown" || format === "md" ? "text" : "json",
  });
  return response.data;
}

export function clearStoredSession() {
  localStorage.removeItem("blockinsure_jwt");
  localStorage.removeItem("blockinsure_wallet");
  localStorage.removeItem("blockinsure_user");
}

export async function attachDocumentToClaim(documentId, claimId, attemptId = "") {
  const response = await api.patch(`/api/documents/${documentId}/claim`, {
    claimId,
    attemptId,
  });
  return response.data;
}
