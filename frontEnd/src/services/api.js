import axios from "axios";

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

export async function createPolicyPackage(payload) {
  const response = await api.post("/api/admin/policy-packages", payload);
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

export async function uploadClaimDocument({ file, documentType, claimId }) {
  const formData = new FormData();

  formData.append("document", file);

  if (documentType) {
    formData.append("documentType", documentType);
  }

  if (claimId) {
    formData.append("claimId", claimId);
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

export async function getClaimById(claimId) {
  const response = await api.get(`/api/claims/${claimId}`);
  return response.data;
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
  const response = await api.patch(`/api/appeals/${appealId}/review`, payload);
  return response.data;
}

export async function getClaimVoteSummary(claimId) {
  const response = await api.get(`/api/votes/claim/${claimId}`);
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

export async function getReserveIntelligence() {
  const response = await api.get("/api/admin/reserve-intelligence");
  return response.data;
}

export async function getEvaluationSummary() {
  const response = await api.get("/api/admin/evaluation/summary");
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

export async function requestOracleVerification(claimId) {
  const response = await api.post(`/api/admin/claims/${claimId}/request-oracle`);
  return response.data;
}

export async function sendClaimToManualReview(claimId) {
  const response = await api.post(`/api/admin/claims/${claimId}/manual-review`);
  return response.data;
}

export async function approveClaim(claimId) {
  const response = await api.post(`/api/admin/claims/${claimId}/approve`);
  return response.data;
}

export async function rejectClaim(claimId, reason) {
  const response = await api.post(`/api/admin/claims/${claimId}/reject`, {
    reason,
  });
  return response.data;
}

export async function settleClaim(claimId) {
  const response = await api.post(`/api/admin/claims/${claimId}/settle`);
  return response.data;
}

export async function getOracleResults(claimId) {
  const response = await api.get(`/api/oracle/results/${claimId}`);
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

export function clearStoredSession() {
  localStorage.removeItem("blockinsure_jwt");
  localStorage.removeItem("blockinsure_wallet");
  localStorage.removeItem("blockinsure_user");
}

export async function attachDocumentToClaim(documentId, claimId) {
  const response = await api.patch(`/api/documents/${documentId}/claim`, {
    claimId,
  });
  return response.data;
}
