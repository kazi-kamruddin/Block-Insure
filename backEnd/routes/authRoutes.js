const express = require("express");
const {
  getNonce,
  logout,
  walletLogin,
} = require("../controllers/authController");
const authMiddleware = require("../middleware/authMiddleware");
const {
  nonceRateLimit,
  walletLoginRateLimit,
} = require("../middleware/claimSubmissionRateLimit");

const router = express.Router();

router.get("/nonce/:walletAddress", nonceRateLimit, getNonce);
router.post("/wallet-login", walletLoginRateLimit, walletLogin);
router.post("/logout", authMiddleware, logout);

module.exports = router;
