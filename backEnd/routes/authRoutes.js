const express = require("express");
const {
  getNonce,
  walletLogin,
} = require("../controllers/authController");

const router = express.Router();

router.get("/nonce/:walletAddress", getNonce);
router.post("/wallet-login", walletLogin);

module.exports = router;