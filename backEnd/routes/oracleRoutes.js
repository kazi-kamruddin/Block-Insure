const express = require("express");
const {
  createOracleLog,
  getOracleLogsByClaim,
} = require("../controllers/oracleController");

const router = express.Router();

router.post("/logs", createOracleLog);
router.get("/results/:claimId", getOracleLogsByClaim);

module.exports = router;