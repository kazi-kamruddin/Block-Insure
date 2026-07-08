const express = require("express");
const { getDefenseSummary } = require("../controllers/evaluationController");
const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

router.get(
  "/defense-summary",
  authMiddleware,
  requireRole("ADMIN"),
  getDefenseSummary
);

module.exports = router;
