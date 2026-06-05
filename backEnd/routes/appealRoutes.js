const express = require("express");
const {
  submitAppeal,
  getAppealByClaim,
  reviewAppeal,
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
router.patch(
  "/:id/review",
  authMiddleware,
  requireRole("ADMIN"),
  reviewAppeal
);

module.exports = router;
