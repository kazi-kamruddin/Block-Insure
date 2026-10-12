const express = require("express");
const {
  getMyPolicies,
  getPolicyById,
  previewPurchasedPolicyEligibility,
} = require("../controllers/policyController");
const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const {
  confirmPremiumPayment,
  downloadInsuranceCertificate,
  downloadPaymentStatement,
  getMyPaymentStatement,
} = require("../controllers/paymentController");

const router = express.Router();

router.get(
  "/payments/my",
  authMiddleware,
  requireRole("USER"),
  getMyPaymentStatement
);
router.get(
  "/payments/statement.csv",
  authMiddleware,
  requireRole("USER"),
  downloadPaymentStatement
);
router.post(
  "/payments/confirm",
  authMiddleware,
  requireRole("USER"),
  confirmPremiumPayment
);
router.get(
  "/:policyId/certificate.html",
  authMiddleware,
  requireRole("USER"),
  downloadInsuranceCertificate
);
router.get("/my", authMiddleware, getMyPolicies);
router.post(
  "/:policyId/eligibility-preview",
  authMiddleware,
  previewPurchasedPolicyEligibility
);
router.get("/:policyId", authMiddleware, getPolicyById);

module.exports = router;
