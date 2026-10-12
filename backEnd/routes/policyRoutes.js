const express = require("express");
const {
  getActivePolicyPackages,
  getPublicPolicyPackage,
  downloadPublicPolicyDocument,
  acceptPublicPolicyTerms,
  getPolicyRuleCatalog,
  getRealisticScenarios,
  getRiskPremiumQuote,
  simulateHistoricalPolicyEligibility,
} = require("../controllers/policyController");
const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

router.get("/", getActivePolicyPackages);
router.get("/rule-catalog", getPolicyRuleCatalog);
router.get("/realistic-scenarios", getRealisticScenarios);
router.post("/:packageId/risk-premium-quote", getRiskPremiumQuote);
router.post("/:packageId/eligibility-preview", simulateHistoricalPolicyEligibility);
router.post(
  "/:packageId/acceptance",
  authMiddleware,
  requireRole("USER"),
  acceptPublicPolicyTerms
);
router.get("/:packageId/document", downloadPublicPolicyDocument);
router.get("/:packageId", getPublicPolicyPackage);

module.exports = router;
