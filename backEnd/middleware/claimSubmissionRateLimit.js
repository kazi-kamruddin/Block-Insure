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

const buildAuthLimiter = ({ windowEnv, limitEnv, defaultLimit, message }) =>
  rateLimit({
    windowMs: Number(process.env[windowEnv] || 15 * 60 * 1000),
    limit: Number(process.env[limitEnv] || defaultLimit),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { success: false, message },
  });

const nonceRateLimit = buildAuthLimiter({
  windowEnv: "AUTH_NONCE_RATE_WINDOW_MS",
  limitEnv: "AUTH_NONCE_RATE_LIMIT",
  defaultLimit: 30,
  message: "Too many nonce requests. Try again later.",
});

const walletLoginRateLimit = buildAuthLimiter({
  windowEnv: "AUTH_LOGIN_RATE_WINDOW_MS",
  limitEnv: "AUTH_LOGIN_RATE_LIMIT",
  defaultLimit: 15,
  message: "Too many wallet login attempts. Try again later.",
});

module.exports = claimSubmissionRateLimit;
module.exports.nonceRateLimit = nonceRateLimit;
module.exports.walletLoginRateLimit = walletLoginRateLimit;
