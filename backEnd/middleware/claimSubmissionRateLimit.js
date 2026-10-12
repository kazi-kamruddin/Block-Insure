const { ipKeyGenerator, rateLimit } = require("express-rate-limit");

const claimSubmissionKey = (req) => {
  const walletAddress = String(req.user?.walletAddress || "").trim().toLowerCase();
  return walletAddress
    ? `wallet:${walletAddress}`
    : `ip:${ipKeyGenerator(req.ip || req.socket?.remoteAddress || "127.0.0.1")}`;
};

const isDevelopmentClaimResetEnabled = (environment = process.env) =>
  environment.NODE_ENV !== "production" &&
  environment.DEV_ALLOW_CLAIM_LIMIT_RESET === "true";

const claimSubmissionRateLimit = rateLimit({
  windowMs: Number(process.env.CLAIM_SUBMISSION_RATE_WINDOW_MS || 15 * 60 * 1000),
  limit: Number(process.env.CLAIM_SUBMISSION_RATE_LIMIT || 5),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: claimSubmissionKey,
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
  defaultLimit: process.env.NODE_ENV === "production" ? 30 : 100,
  message: "Too many nonce requests. Try again later.",
});

const walletLoginRateLimit = buildAuthLimiter({
  windowEnv: "AUTH_LOGIN_RATE_WINDOW_MS",
  limitEnv: "AUTH_LOGIN_RATE_LIMIT",
  // The local browser suite signs in several independent role wallets in one
  // process, so they all share the same loopback IP. Keep production's tighter
  // per-IP limit while allowing the documented multi-role rehearsal locally.
  defaultLimit: process.env.NODE_ENV === "production" ? 15 : 100,
  message: "Too many wallet login attempts. Try again later.",
});

module.exports = claimSubmissionRateLimit;
module.exports.claimSubmissionKey = claimSubmissionKey;
module.exports.resetClaimSubmissionRateLimit = (req, _res, next) => {
  if (isDevelopmentClaimResetEnabled()) {
    claimSubmissionRateLimit.resetKey(claimSubmissionKey(req));
  }
  next();
};
module.exports.isDevelopmentClaimResetEnabled = isDevelopmentClaimResetEnabled;
module.exports.nonceRateLimit = nonceRateLimit;
module.exports.walletLoginRateLimit = walletLoginRateLimit;
