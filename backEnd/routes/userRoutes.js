const express = require("express");
const {
  registerUser,
  getMe,
} = require("../controllers/userController");
const authMiddleware = require("../middleware/authMiddleware");
const { bankOtpConfirmRateLimit, bankOtpRequestRateLimit } = require("../middleware/bankPaymentRateLimit");
const { requestVerification, confirmVerification } = require("../services/emailVerificationService");

const router = express.Router();

router.post("/register", authMiddleware, registerUser);
router.get("/me", authMiddleware, getMe);
router.post("/email-verification", authMiddleware, bankOtpRequestRateLimit, async (req, res, next) => {
  try { res.json({ success: true, ...await requestVerification(req.user.walletAddress) }); } catch (error) { next(error); }
});
router.post("/email-verification/confirm", authMiddleware, bankOtpConfirmRateLimit, async (req, res, next) => {
  try { res.json({ success: true, ...await confirmVerification(req.user.walletAddress, req.body?.challengeId, req.body?.otp) }); } catch (error) { next(error); }
});

module.exports = router;
