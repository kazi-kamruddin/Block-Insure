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
const { getShadowPacket, saveShadowReport } = require("../controllers/oracleShadowController");
const { rateLimit } = require("express-rate-limit");

const router = express.Router();
const shadowLimit = rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: "draft-8", legacyHeaders: false });
router.get("/monitoring", authMiddleware, requireRole("ADMIN"), require("../controllers/protocolMonitoringController").getProtocolMonitoring);
router.post("/shadow/context", requireOracleApiKey, shadowLimit, getShadowPacket);
router.post("/shadow/report", requireOracleApiKey, shadowLimit, saveShadowReport);
router.post("/protocol/decision/read", requireOracleApiKey, shadowLimit, require("../controllers/oracleDecisionController").readDecision);
router.post("/protocol/decision/save", requireOracleApiKey, shadowLimit, require("../controllers/oracleDecisionController").saveDecision);

router.post("/logs", requireOracleApiKey, createOracleLog);
router.post("/heartbeat", requireOracleApiKey, recordOracleHeartbeat);
router.get("/cursor", requireOracleApiKey, getOracleCursor);
router.put("/cursor", requireOracleApiKey, saveOracleCursor);
router.get("/results/:claimId", authMiddleware, getOracleLogsByClaim);
router.get("/health", authMiddleware, requireRole("ADMIN"), getOracleHealth);

module.exports = router;
