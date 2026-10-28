const express = require("express");
const {
  submitAppeal,
  getAppealByClaim,
} = require("../controllers/appealController");
const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();
const attempts = require("../controllers/appealAttemptController");
router.get("/attempts", authMiddleware, requireRole("USER"), attempts.list);
router.post("/attempts", authMiddleware, requireRole("USER"), attempts.prepare);
router.post("/attempts/:attemptId/ready", authMiddleware, requireRole("USER"), attempts.ready);
router.patch("/attempts/:attemptId/transaction", authMiddleware, requireRole("USER"), attempts.recordTransaction);
router.post("/attempts/:attemptId/reconcile", authMiddleware, requireRole("USER"), attempts.reconcile);

router.post("/", authMiddleware, requireRole("USER"), submitAppeal);
router.get(
  "/claim/:claimId",
  authMiddleware,
  requireRole("USER", "ADMIN", "AUDITOR"),
  getAppealByClaim
);
module.exports = router;
