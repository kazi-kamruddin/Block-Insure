const express = require("express");
const {
  createOracleLog,
  getOracleCursor,
  getOracleHealth,
  getOracleLogsByClaim,
  recordOracleHeartbeat,
  saveOracleCursor,
} = require("../controllers/oracleController");
const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const requireOracleApiKey = require("../middleware/oracleApiKeyMiddleware");

const router = express.Router();

router.post("/logs", requireOracleApiKey, createOracleLog);
router.post("/heartbeat", requireOracleApiKey, recordOracleHeartbeat);
router.get("/cursor", requireOracleApiKey, getOracleCursor);
router.put("/cursor", requireOracleApiKey, saveOracleCursor);
router.get("/results/:claimId", authMiddleware, getOracleLogsByClaim);
router.get("/health", authMiddleware, requireRole("ADMIN"), getOracleHealth);

module.exports = router;
