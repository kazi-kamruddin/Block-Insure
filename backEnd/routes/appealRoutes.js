const express = require("express");
const {
  submitAppeal,
  getAppealByClaim,
} = require("../controllers/appealController");
const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

router.post("/", authMiddleware, requireRole("USER"), submitAppeal);
router.get(
  "/claim/:claimId",
  authMiddleware,
  requireRole("USER", "ADMIN", "AUDITOR"),
  getAppealByClaim
);
module.exports = router;
