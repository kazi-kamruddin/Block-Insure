const jwt = require("jsonwebtoken");
const RevokedToken = require("../models/RevokedToken");
const User = require("../models/User");
const JWT_ISSUER = process.env.JWT_ISSUER || "block-insure-api";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "block-insure-client";

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authorization token missing",
      });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      audience: JWT_AUDIENCE,
      issuer: JWT_ISSUER,
    });
    const walletAddress = decoded.walletAddress?.toLowerCase();

    if (!walletAddress || !decoded.jti) {
      return res.status(401).json({
        success: false,
        message: "Invalid token payload",
      });
    }

    const revokedToken = await RevokedToken.findOne({ jti: decoded.jti })
      .select("_id")
      .lean();

    if (revokedToken) {
      return res.status(401).json({
        success: false,
        message: "Token has been revoked",
      });
    }

    const user = await User.findOne({ walletAddress }).select("walletAddress role");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User no longer exists",
      });
    }

    req.user = {
      walletAddress: user.walletAddress,
      role: user.role,
    };
    req.authToken = decoded;

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};

module.exports = authMiddleware;
