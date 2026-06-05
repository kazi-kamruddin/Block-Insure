const express = require("express");
const {
  getAdminActionLogs,
  getClaimAuditTimeline,
} = require("../controllers/auditController");
const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

router.get(
  "/claims/:id",
  authMiddleware,
  requireRole("AUDITOR", "ADMIN"),
  getClaimAuditTimeline
);

router.get(
  "/admin-actions",
  authMiddleware,
  requireRole("ADMIN"),
  getAdminActionLogs
);

module.exports = router;
