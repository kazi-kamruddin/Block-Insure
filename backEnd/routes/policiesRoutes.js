const express = require("express");
const {
  getMyPolicies,
  getPolicyById,
  previewPurchasedPolicyEligibility,
} = require("../controllers/policyController");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/my", authMiddleware, getMyPolicies);
router.post(
  "/:policyId/eligibility-preview",
  authMiddleware,
  previewPurchasedPolicyEligibility
);
router.get("/:policyId", authMiddleware, getPolicyById);

module.exports = router;
