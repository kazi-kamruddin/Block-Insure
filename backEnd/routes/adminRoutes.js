const express = require("express");
const {
  getAllPolicyPackages,
  createPolicyPackage,
  updatePolicyPackage,
  deactivatePolicyPackage,
  reactivatePolicyPackage,
  getReserveIntelligence,
  getRegistryMerkleRoot,
  pushRegistryMerkleRoot,
  listAdminActionLogs,
  getRoleSyncHealth,
  getAdminClaims,
  confirmAdminClaimTransaction,
  publishPolicyPackageEconomicRules,
} = require("../controllers/adminController");
const {
  getAuditorReputationAnalysis,
  getDefenseSummary,
  getEvaluationSummary,
  getGasComparison,
  getOracleStats,
  getRiskDistribution,
  getThroughputResults,
} = require("../controllers/evaluationController");
const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const {
  approveBenefitRequest,
  listBenefitRequests,
  confirmPublishedBenefitTerms,
  rejectBenefitRequest,
  settleBenefitRequest,
} = require("../controllers/policyBenefitsController");

const router = express.Router();

router.get(
  "/benefit-requests",
  authMiddleware,
  requireRole("ADMIN"),
  listBenefitRequests
);
router.post(
  "/policy-packages/:packageId/benefit-terms/confirm",
  authMiddleware,
  requireRole("ADMIN"),
  confirmPublishedBenefitTerms
);
router.post(
  "/benefit-requests/:requestId/approve",
  authMiddleware,
  requireRole("ADMIN"),
  approveBenefitRequest
);
router.post(
  "/benefit-requests/:requestId/reject",
  authMiddleware,
  requireRole("ADMIN"),
  rejectBenefitRequest
);
router.post(
  "/benefit-requests/:requestId/settle",
  authMiddleware,
  requireRole("ADMIN"),
  settleBenefitRequest
);

router.get(
  "/policy-packages",
  authMiddleware,
  requireRole("ADMIN"),
  getAllPolicyPackages
);

router.post(
  "/claims/:id/confirm-transaction",
  authMiddleware,
  requireRole("ADMIN"),
  confirmAdminClaimTransaction
);

router.post(
  "/policy-packages",
  authMiddleware,
  requireRole("ADMIN"),
  createPolicyPackage
);

router.post(
  "/policy-packages/:id/economic-rules",
  authMiddleware,
  requireRole("ADMIN"),
  publishPolicyPackageEconomicRules
);

router.put(
  "/policy-packages/:id",
  authMiddleware,
  requireRole("ADMIN"),
  updatePolicyPackage
);

router.post(
  "/policy-packages/:id/deactivate",
  authMiddleware,
  requireRole("ADMIN"),
  deactivatePolicyPackage
);

router.post(
  "/policy-packages/:id/reactivate",
  authMiddleware,
  requireRole("ADMIN"),
  reactivatePolicyPackage
);

router.get(
  "/reserve-intelligence",
  authMiddleware,
  requireRole("ADMIN"),
  getReserveIntelligence
);

router.get(
  "/settlement-intelligence",
  authMiddleware,
  requireRole("ADMIN"),
  getReserveIntelligence
);

router.get(
  "/evaluation/summary",
  authMiddleware,
  requireRole("ADMIN"),
  getEvaluationSummary
);

router.get(
  "/evaluation/defense-summary",
  authMiddleware,
  requireRole("ADMIN"),
  getDefenseSummary
);

router.get(
  "/evaluation/gas-comparison",
  authMiddleware,
  requireRole("ADMIN"),
  getGasComparison
);

router.get(
  "/evaluation/risk-distribution",
  authMiddleware,
  requireRole("ADMIN"),
  getRiskDistribution
);

router.get(
  "/evaluation/oracle-stats",
  authMiddleware,
  requireRole("ADMIN"),
  getOracleStats
);

router.get(
  "/evaluation/throughput",
  authMiddleware,
  requireRole("ADMIN"),
  getThroughputResults
);

router.get(
  "/evaluation/auditor-reputation",
  authMiddleware,
  requireRole("ADMIN"),
  getAuditorReputationAnalysis
);

router.get(
  "/registry/merkle-root",
  authMiddleware,
  requireRole("ADMIN"),
  getRegistryMerkleRoot
);

router.post(
  "/registry/push-merkle-root",
  authMiddleware,
  requireRole("ADMIN"),
  pushRegistryMerkleRoot
);

router.get(
  "/audit-logs",
  authMiddleware,
  requireRole("ADMIN"),
  listAdminActionLogs
);

router.get(
  "/role-sync-health",
  authMiddleware,
  requireRole("ADMIN"),
  getRoleSyncHealth
);

router.get(
  "/claims",
  authMiddleware,
  requireRole("ADMIN"),
  getAdminClaims
);

module.exports = router;
