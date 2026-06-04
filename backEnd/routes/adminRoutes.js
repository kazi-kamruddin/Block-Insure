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
  getAdminClaims,
  requestOracleForClaim,
  approveClaim,
  rejectClaim,
  settleClaim,
  closeClaim,
  sendClaimToManualReview,
} = require("../controllers/adminController");
const {
  getEvaluationSummary,
  getGasComparison,
  getOracleStats,
  getRiskDistribution,
} = require("../controllers/evaluationController");
const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

router.get(
  "/policy-packages",
  authMiddleware,
  requireRole("ADMIN"),
  getAllPolicyPackages
);

router.post(
  "/policy-packages",
  authMiddleware,
  requireRole("ADMIN"),
  createPolicyPackage
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
  "/claims",
  authMiddleware,
  requireRole("ADMIN"),
  getAdminClaims
);

router.post(
  "/claims/:id/request-oracle",
  authMiddleware,
  requireRole("ADMIN"),
  requestOracleForClaim
);

router.post(
  "/claims/:id/manual-review",
  authMiddleware,
  requireRole("ADMIN"),
  sendClaimToManualReview
);

router.post(
  "/claims/:id/approve",
  authMiddleware,
  requireRole("ADMIN"),
  approveClaim
);

router.post(
  "/claims/:id/reject",
  authMiddleware,
  requireRole("ADMIN"),
  rejectClaim
);

router.post(
  "/claims/:id/settle",
  authMiddleware,
  requireRole("ADMIN"),
  settleClaim
);

router.post(
  "/claims/:id/close",
  authMiddleware,
  requireRole("ADMIN"),
  closeClaim
);

module.exports = router;
