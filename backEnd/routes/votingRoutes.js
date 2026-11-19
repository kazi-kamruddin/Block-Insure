const express = require("express");
const {
  getClaimVoteSummary, prepareVoteReason,
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

router.post("/claim/:claimId/reason", authMiddleware, requireRole("AUDITOR"), prepareVoteReason);
module.exports = router;
