const express = require("express");
const { getClaimAuditTimeline } = require("../controllers/auditController");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/claims/:id", authMiddleware, getClaimAuditTimeline);

module.exports = router;