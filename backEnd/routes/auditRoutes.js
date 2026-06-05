const express = require("express");
const { getClaimAuditTimeline } = require("../controllers/auditController");
const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

router.get(
  "/claims/:id",
  authMiddleware,
  requireRole("AUDITOR", "ADMIN"),
  getClaimAuditTimeline
);

module.exports = router;
