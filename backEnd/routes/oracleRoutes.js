const express = require("express");
const {
  createOracleLog,
  getOracleHealth,
  getOracleLogsByClaim,
  recordOracleHeartbeat,
} = require("../controllers/oracleController");
const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

const requireOracleApiKey = (req, res, next) => {
  const expectedApiKey = process.env.ORACLE_API_KEY;
  const providedApiKey =
    req.headers["x-oracle-api-key"] ||
    req.headers.authorization?.replace(/^Bearer\s+/i, "");

  if (!expectedApiKey) {
    return res.status(500).json({
      success: false,
      message: "ORACLE_API_KEY is not configured",
    });
  }

  if (providedApiKey !== expectedApiKey) {
    return res.status(401).json({
      success: false,
      message: "Invalid oracle API key",
    });
  }

  next();
};

router.post("/logs", requireOracleApiKey, createOracleLog);
router.post("/heartbeat", requireOracleApiKey, recordOracleHeartbeat);
router.get("/results/:claimId", authMiddleware, getOracleLogsByClaim);
router.get("/health", authMiddleware, requireRole("ADMIN"), getOracleHealth);

module.exports = router;
