const express = require("express");
const {
  getMyClaims,
  getClaimById,
} = require("../controllers/claimController");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/my", authMiddleware, getMyClaims);
router.get("/:claimId", authMiddleware, getClaimById);

module.exports = router;