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

router.get("/oracle-readiness", authMiddleware, requireRole("ADMIN", "CLAIM_OFFICER"), async (req, res) => {
  try {
    const manager = require("../services/contractService").getReadOnlyContract();
    const { claimId } = req.query;
    if (typeof claimId === "string" && /^[1-9]\d*$/.test(claimId)) {
      const version = Number(await manager.claimVersion(claimId));
      if (version > 1) {
        const scope = await require("../services/deploymentScopeService").getDeploymentScope(manager.runner.provider);
        const pending = await require("../models/ClaimClarification").exists({ scope, claimId, priorVersion: version - 1, confirmed: false });
        if (pending) return res.status(409).json({ ready: false, message: "Register the confirmed clarification before requesting verification." });
      }
    }
    const network = await manager.runner.provider.getNetwork();
    const origins = process.env.ORACLE_READY_URLS?.split(",").map(url => url.trim()) ||
      (network.chainId === 31337n ? ["http://127.0.0.1:5101", "http://127.0.0.1:5102"] :
      ["https://block-insure-oracle-one.onrender.com", "https://block-insure-oracle-two.onrender.com"]);
    if (origins.length !== 2) throw new Error("Two worker URLs are required");
    const workers = await Promise.all(origins.map(async origin => {
      const response = await fetch(new URL("/health/ready", origin), { signal: AbortSignal.timeout(20000) });
      if (!response.ok) return null;
      return response.json();
    }));
    const ready = workers.every(worker => worker?.status === "ready" && worker.workerEnabled &&
      worker.deployment?.chainId === String(network.chainId) && worker.deployment.managerAddress === manager.target.toLowerCase() &&
      Number.isSafeInteger(worker.scanLagBlocks) && worker.scanLagBlocks >= 0 && worker.scanLagBlocks <= 20) &&
      new Set(workers.map(worker => worker.oracleInstanceId)).size === 2;
    res.set("Cache-Control", "no-store").status(ready ? 200 : 503).json({ ready,
      message: ready ? "Both workers are ready." : "Workers are waking or catching up. Try verification again." });
  } catch {
    res.status(503).json({ ready: false, message: "Worker readiness is unavailable. Retry before opening the verification window." });
  }
});
module.exports = router;
