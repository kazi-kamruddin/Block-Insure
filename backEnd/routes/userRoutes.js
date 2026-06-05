const express = require("express");
const {
  registerUser,
  getMe,
} = require("../controllers/userController");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/register", authMiddleware, registerUser);
router.get("/me", authMiddleware, getMe);

module.exports = router;