const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { verifyMessage, getAddress } = require("ethers");
const RevokedToken = require("../models/RevokedToken");
const User = require("../models/User");

const normalizeWalletAddress = (walletAddress) => {
  return getAddress(walletAddress).toLowerCase();
};
const JWT_ISSUER = process.env.JWT_ISSUER || "block-insure-api";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "block-insure-client";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
const NONCE_TTL_MS = Number(process.env.AUTH_NONCE_TTL_MS || 5 * 60 * 1000);

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const getNonce = async (req, res, next) => {
  try {
    const walletAddress = normalizeWalletAddress(req.params.walletAddress);

    const nonce = crypto.randomBytes(16).toString("hex");
    const message = `Block-Insure login nonce: ${nonce}`;
    const nonceExpiresAt = new Date(Date.now() + NONCE_TTL_MS);

    const user = await User.findOneAndUpdate(
      { walletAddress },
      {
        walletAddress,
        nonce,
        nonceExpiresAt,
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    res.status(200).json({
      success: true,
      walletAddress: user.walletAddress,
      nonce,
      message,
      expiresAt: nonceExpiresAt.toISOString(),
    });
  } catch (error) {
    next(error);
  }
};

const walletLogin = async (req, res, next) => {
  try {
    const { walletAddress, signature } = req.body;

    if (!walletAddress || !signature) {
      throw createError("walletAddress and signature are required", 400);
    }

    if (!process.env.JWT_SECRET) {
      throw createError("JWT_SECRET is not configured", 500);
    }

    const normalizedWallet = normalizeWalletAddress(walletAddress);

    const user = await User.findOne({ walletAddress: normalizedWallet });

    if (!user || !user.nonce) {
      throw createError("Nonce not found. Request a nonce first.", 400);
    }

    if (!user.nonceExpiresAt || user.nonceExpiresAt <= new Date()) {
      throw createError("Nonce expired. Request a new nonce.", 401);
    }

    const message = `Block-Insure login nonce: ${user.nonce}`;
    const recoveredAddress = verifyMessage(message, signature).toLowerCase();

    if (recoveredAddress !== normalizedWallet) {
      throw createError("Invalid wallet signature", 401);
    }

    const consumedUser = await User.findOneAndUpdate(
      {
        _id: user._id,
        nonce: user.nonce,
        nonceExpiresAt: { $gt: new Date() },
      },
      { $set: { nonce: "", nonceExpiresAt: null } },
      { new: true }
    );

    if (!consumedUser) {
      throw createError("Nonce was already used or expired.", 401);
    }

    const token = jwt.sign(
      {
        jti: crypto.randomUUID(),
        walletAddress: consumedUser.walletAddress,
        role: consumedUser.role,
      },
      process.env.JWT_SECRET,
      {
        audience: JWT_AUDIENCE,
        expiresIn: JWT_EXPIRES_IN,
        issuer: JWT_ISSUER,
      }
    );

    res.status(200).json({
      success: true,
      message: "Wallet login successful",
      token,
      user: {
        walletAddress: consumedUser.walletAddress,
        role: consumedUser.role,
        name: consumedUser.name,
        email: consumedUser.email,
      },
    });
  } catch (error) {
    next(error);
  }
};

const logout = async (req, res, next) => {
  try {
    const { jti, exp } = req.authToken || {};

    if (!jti || !exp) {
      throw createError("Token cannot be revoked", 400);
    }

    await RevokedToken.findOneAndUpdate(
      { jti },
      {
        $setOnInsert: {
          jti,
          walletAddress: req.user.walletAddress,
          expiresAt: new Date(exp * 1000),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({
      success: true,
      message: "Logout successful",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getNonce,
  logout,
  walletLogin,
};
