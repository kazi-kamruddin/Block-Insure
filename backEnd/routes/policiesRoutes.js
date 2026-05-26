const express = require("express");
const {
  getMyPolicies,
  getPolicyById,
} = require("../controllers/policyController");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/my", authMiddleware, getMyPolicies);
router.get("/:policyId", authMiddleware, getPolicyById);

module.exports = router;