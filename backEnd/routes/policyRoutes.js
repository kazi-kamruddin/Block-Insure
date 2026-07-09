const express = require("express");
const {
  getActivePolicyPackages,
  getRiskPremiumQuote,
} = require("../controllers/policyController");

const router = express.Router();

router.get("/", getActivePolicyPackages);
router.post("/:packageId/risk-premium-quote", getRiskPremiumQuote);

module.exports = router;
