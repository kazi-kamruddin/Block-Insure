const express = require("express");
const {
  finalizeVoting,
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

router.post(
  "/finalize/:claimId",
  authMiddleware,
  requireRole("ADMIN"),
  finalizeVoting
);

module.exports = router;
