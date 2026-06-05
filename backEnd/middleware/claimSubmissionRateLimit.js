const { rateLimit } = require("express-rate-limit");

const claimSubmissionRateLimit = rateLimit({
  windowMs: Number(process.env.CLAIM_SUBMISSION_RATE_WINDOW_MS || 15 * 60 * 1000),
  limit: Number(process.env.CLAIM_SUBMISSION_RATE_LIMIT || 5),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many claim submission attempts. Try again later.",
  },
});

module.exports = claimSubmissionRateLimit;
