const express = require("express");
const {
  downloadPolicyTerms,
  getPackageBenefitTerms,
  getPolicyBenefits,
  confirmRefundWithdrawal,
} = require("../controllers/policyBenefitsController");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/packages/:packageId/terms", getPackageBenefitTerms);
router.get("/policies/:policyId", authMiddleware, getPolicyBenefits);
router.get("/policies/:policyId/document", authMiddleware, downloadPolicyTerms);
router.post("/withdrawals/confirm", authMiddleware, confirmRefundWithdrawal);

module.exports = router;
