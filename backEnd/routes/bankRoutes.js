const express = require("express");
const bankController = require("../controllers/bankController");
const authMiddleware = require("../middleware/authMiddleware");
const { bankOtpConfirmRateLimit, bankOtpRequestRateLimit } = require("../middleware/bankPaymentRateLimit");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

router.get("/network", bankController.getNetworkBanks);
router.get("/me", authMiddleware, requireRole("BANK"), bankController.getMyBankProfile);
router.get("/accounts", authMiddleware, requireRole("BANK"), bankController.getMyBankAccounts);
router.get("/mandates", authMiddleware, requireRole("BANK"), bankController.getMyBankMandates);
router.get("/transactions", authMiddleware, requireRole("BANK"), bankController.getMyBankTransactions);
router.post("/mandates/:mandateId/approve", authMiddleware, requireRole("BANK"), bankController.approveMyBankMandate);
router.post("/mandates/:mandateId/reject", authMiddleware, requireRole("BANK"), bankController.rejectMyBankMandate);
router.post("/automation/run", authMiddleware, requireRole("BANK"), bankController.runMyBankAutomation);

router.get("/user/accounts", authMiddleware, requireRole("USER"), bankController.getMyUserAccounts);
router.get("/user/mandates", authMiddleware, requireRole("USER"), bankController.getMyUserMandates);
router.get("/user/transactions", authMiddleware, requireRole("USER"), bankController.getMyUserTransactions);
router.post("/user/mandates", authMiddleware, requireRole("USER"), bankController.createMyMandate);
router.patch("/user/mandates/:mandateId/cancel", authMiddleware, requireRole("USER"), bankController.cancelMyMandate);
router.post("/user/manual-payments/otp", authMiddleware, requireRole("USER"), bankOtpRequestRateLimit, bankController.requestMyManualOtp);
router.post("/user/manual-payments/confirm", authMiddleware, requireRole("USER"), bankOtpConfirmRateLimit, bankController.confirmMyManualOtp);

module.exports = router;
