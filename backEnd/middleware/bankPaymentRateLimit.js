const { rateLimit } = require("express-rate-limit");

const buildBankPaymentLimiter = ({ limit, message }) =>
  rateLimit({
    windowMs: Number(process.env.BANK_PAYMENT_RATE_WINDOW_MS || 15 * 60 * 1000),
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => req.user.walletAddress,
    message: { success: false, message },
  });

const bankOtpRequestRateLimit = buildBankPaymentLimiter({
  limit: Number(process.env.BANK_OTP_REQUEST_RATE_LIMIT || 5),
  message: "Too many payment-code requests. Try again later.",
});

const bankOtpConfirmRateLimit = buildBankPaymentLimiter({
  limit: Number(process.env.BANK_OTP_CONFIRM_RATE_LIMIT || 10),
  message: "Too many payment-code attempts. Try again later.",
});

module.exports = { bankOtpConfirmRateLimit, bankOtpRequestRateLimit };
