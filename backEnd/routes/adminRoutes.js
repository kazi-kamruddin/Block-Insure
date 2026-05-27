const express = require("express");
const {
  createPolicyPackage,
  getAdminClaims,
  requestOracleForClaim,
  approveClaim,
  rejectClaim,
  settleClaim,
  sendClaimToManualReview,
} = require("../controllers/adminController");
const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

router.post(
  "/policy-packages",
  authMiddleware,
  requireRole("ADMIN"),
  createPolicyPackage
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

module.exports = router;