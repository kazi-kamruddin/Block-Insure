const express = require("express");
const {
  downloadPolicyTerms,
  getPackageBenefitTerms,
  getPolicyBenefits,
} = require("../controllers/policyBenefitsController");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/packages/:packageId/terms", getPackageBenefitTerms);
router.get("/policies/:policyId", authMiddleware, getPolicyBenefits);
router.get("/policies/:policyId/document", authMiddleware, downloadPolicyTerms);

module.exports = router;
