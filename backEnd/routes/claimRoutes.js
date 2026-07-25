const express = require("express");
const {
  authorizeClaimSubmission,
  abandonClaimSubmission,
  getReadableClaims,
  getMyClaims,
  getClaimById,
  getClaimDocumentHash,
  reconcileClaimSubmission,
  recordClaimTransaction,
} = require("../controllers/claimController");
const authMiddleware = require("../middleware/authMiddleware");
const claimSubmissionRateLimit = require("../middleware/claimSubmissionRateLimit");

const router = express.Router();

router.post(
  "/submission-check",
  authMiddleware,
  claimSubmissionRateLimit,
  authorizeClaimSubmission
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
router.get("/:claimId/document-hash", authMiddleware, getClaimDocumentHash);
router.get("/:claimId", authMiddleware, getClaimById);

module.exports = router;
