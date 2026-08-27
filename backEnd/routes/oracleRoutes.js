const express = require("express");
const {
  createOracleLog,
  getOracleHealth,
  getOracleLogsByClaim,
  recordOracleHeartbeat,
} = require("../controllers/oracleController");
const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const requireOracleApiKey = require("../middleware/oracleApiKeyMiddleware");

const router = express.Router();

router.post("/logs", requireOracleApiKey, createOracleLog);
router.post("/heartbeat", requireOracleApiKey, recordOracleHeartbeat);
router.get("/results/:claimId", authMiddleware, getOracleLogsByClaim);
router.get("/health", authMiddleware, requireRole("ADMIN"), getOracleHealth);

module.exports = router;
