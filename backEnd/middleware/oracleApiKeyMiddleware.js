const crypto = require("node:crypto");

const keysMatch = (provided, expected) => {
  const providedBuffer = Buffer.from(String(provided || ""), "utf8");
  const expectedBuffer = Buffer.from(String(expected || ""), "utf8");
  return (
    providedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  );
};

const requireOracleApiKey = (req, res, next) => {
  const expectedApiKey = process.env.ORACLE_API_KEY;
  const providedApiKey =
    req.headers["x-oracle-api-key"] ||
    req.headers.authorization?.replace(/^Bearer\s+/i, "");

  if (!expectedApiKey) {
    return res.status(500).json({
      success: false,
      message: "ORACLE_API_KEY is not configured",
    });
  }

  if (!keysMatch(providedApiKey, expectedApiKey)) {
    return res.status(401).json({
      success: false,
      message: "Invalid oracle API key",
    });
  }

  next();
};

module.exports = requireOracleApiKey;
