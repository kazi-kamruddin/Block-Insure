const express = require("express");
const {
  authorizeClaimSubmission,
  getReadableClaims,
  getMyClaims,
  getClaimById,
  getClaimDocumentHash,
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
router.get("/my", authMiddleware, getMyClaims);
router.get("/all", authMiddleware, getReadableClaims);
router.get("/:claimId/document-hash", authMiddleware, getClaimDocumentHash);
router.get("/:claimId", authMiddleware, getClaimById);

module.exports = router;
