const express = require("express");
const {
  getActivePolicyPackages,
  getPolicyRuleCatalog,
  getRealisticScenarios,
  getRiskPremiumQuote,
  simulateHistoricalPolicyEligibility,
} = require("../controllers/policyController");

const router = express.Router();

router.get("/", getActivePolicyPackages);
router.get("/rule-catalog", getPolicyRuleCatalog);
router.get("/realistic-scenarios", getRealisticScenarios);
router.post("/:packageId/risk-premium-quote", getRiskPremiumQuote);
router.post("/:packageId/eligibility-preview", simulateHistoricalPolicyEligibility);

module.exports = router;
