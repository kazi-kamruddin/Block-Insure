const express = require("express");
const {
  authorizeClaimSubmission,
  previewInvoiceEligibility,
  abandonClaimSubmission,
  getReadableClaims,
  getMyClaims,
  getClaimById,
  getClaimDocumentHash,
  reconcileClaimSubmission,
  recordClaimTransaction,
  resetMyClaimSubmissionLimit,
} = require("../controllers/claimController");
const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { getClaimAdvisory } = require("../controllers/advisoryController");
const { rateLimit } = require("express-rate-limit");
const claimSubmissionRateLimit = require("../middleware/claimSubmissionRateLimit");
const {
  resetClaimSubmissionRateLimit,
} = require("../middleware/claimSubmissionRateLimit");

const router = express.Router();
router.post("/invoice-eligibility", authMiddleware, previewInvoiceEligibility);

router.post(
  "/submission-check",
  authMiddleware,
  claimSubmissionRateLimit,
  authorizeClaimSubmission
);
router.delete(
  "/submission-limit/me",
  authMiddleware,
  resetClaimSubmissionRateLimit,
  resetMyClaimSubmissionLimit
);
router.patch(
  "/submission-attempts/:attemptId/transaction",
  authMiddleware,
  recordClaimTransaction
);
router.post(
  "/submission-attempts/:attemptId/reconcile",
  authMiddleware,
  reconcileClaimSubmission
);
router.delete(
  "/submission-attempts/:attemptId",
  authMiddleware,
  abandonClaimSubmission
);
router.get("/my", authMiddleware, getMyClaims);
router.get("/all", authMiddleware, getReadableClaims);
router.get("/:claimId/advisory", authMiddleware, requireRole("ADMIN"), rateLimit({
  windowMs: 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false,
  keyGenerator: (req) => req.user.walletAddress.toLowerCase(),
}), getClaimAdvisory);
router.get("/:claimId/document-hash", authMiddleware, getClaimDocumentHash);
router.get("/:claimId", authMiddleware, getClaimById);

module.exports = router;
