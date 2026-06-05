const express = require("express");
const {
  getNonce,
  logout,
  walletLogin,
} = require("../controllers/authController");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/nonce/:walletAddress", getNonce);
router.post("/wallet-login", walletLogin);
router.post("/logout", authMiddleware, logout);

module.exports = router;
