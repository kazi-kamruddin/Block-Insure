const express = require("express");
const {
  getClaimVoteSummary,
} = require("../controllers/votingController");
const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

router.get(
  "/claim/:claimId",
  authMiddleware,
  requireRole("AUDITOR", "ADMIN"),
  getClaimVoteSummary
);

module.exports = router;
