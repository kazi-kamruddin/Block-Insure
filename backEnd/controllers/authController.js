const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { getAddress } = require("ethers");
const { SiweMessage } = require("siwe");
const RevokedToken = require("../models/RevokedToken");
const User = require("../models/User");

const normalizeWalletAddress = (walletAddress) =>
  getAddress(walletAddress).toLowerCase();
const JWT_ISSUER = process.env.JWT_ISSUER || "block-insure-api";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "block-insure-client";
const NONCE_TTL_MS = Number(process.env.AUTH_NONCE_TTL_MS || 5 * 60 * 1000);
const SESSION_TTL_MS = Number(process.env.AUTH_SESSION_TTL_MS || 60 * 60 * 1000);

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const requestDomain = (req) => process.env.SIWE_DOMAIN || req.get("host");
const requestUri = (req) =>
  process.env.SIWE_URI || `${req.protocol}://${req.get("host")}`;

const getNonce = async (req, res, next) => {
  try {
    const walletAddress = normalizeWalletAddress(req.params.walletAddress);
    const nonce = crypto.randomBytes(16).toString("hex");
    const issuedAt = new Date();
    const expirationTime = new Date(issuedAt.getTime() + NONCE_TTL_MS);
    const chainId = Number(process.env.CHAIN_ID || 31337);
    const user = await User.findOneAndUpdate(
      { walletAddress },
      { walletAddress, nonce, nonceExpiresAt: expirationTime },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    const resources = [
      `urn:block-insure:role:${user.role.toLowerCase()}`,
      `urn:block-insure:evidence`,
    ];
    if (process.env.VITE_CONTRACT_ADDRESS) {
      resources.push(
        `urn:eip155:${chainId}:${process.env.VITE_CONTRACT_ADDRESS.toLowerCase()}`
      );
    }
    const siwe = new SiweMessage({
      domain: requestDomain(req),
      address: getAddress(walletAddress),
      statement: "Authenticate to Block-Insure with current on-chain authorization.",
      uri: requestUri(req),
      version: "1",
      chainId,
      nonce,
      issuedAt: issuedAt.toISOString(),
      expirationTime: expirationTime.toISOString(),
      resources,
    });
    const message = siwe.prepareMessage();

    res.status(200).json({
      success: true,
      walletAddress: user.walletAddress,
      nonce,
      message,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expirationTime.toISOString(),
      resources,
    });
  } catch (error) {
    next(error);
  }
};

const walletLogin = async (req, res, next) => {
  try {
    const { message, signature } = req.body;
    if (!message || !signature) {
      throw createError("SIWE message and signature are required", 400);
    }
    if (!process.env.JWT_SECRET) {
      throw createError("JWT_SECRET is not configured", 500);
    }

    const siwe = new SiweMessage(message);
    const normalizedWallet = normalizeWalletAddress(siwe.address);
    if (
      req.body.walletAddress &&
      normalizeWalletAddress(req.body.walletAddress) !== normalizedWallet
    ) {
      throw createError("SIWE wallet does not match requested wallet", 401);
    }
    if (siwe.domain !== requestDomain(req) || siwe.uri !== requestUri(req)) {
      throw createError("SIWE domain or URI mismatch", 401);
    }
    if (Number(siwe.chainId) !== Number(process.env.CHAIN_ID || 31337)) {
      throw createError("SIWE chain ID mismatch", 401);
    }

    const user = await User.findOne({ walletAddress: normalizedWallet });
    if (!user?.nonce || user.nonce !== siwe.nonce) {
      throw createError("SIWE nonce not found or already consumed", 401);
    }
    if (!user.nonceExpiresAt || user.nonceExpiresAt <= new Date()) {
      throw createError("SIWE nonce expired", 401);
    }
    let verification;
    try {
      verification = await siwe.verify({
        signature,
        domain: requestDomain(req),
        nonce: user.nonce,
        time: new Date().toISOString(),
      });
    } catch {
      throw createError("Invalid SIWE signature or message lifetime", 401);
    }
    if (!verification.success) throw createError("Invalid SIWE signature", 401);

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
      throw createError("SIWE nonce was already used or expired", 401);
    }

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + SESSION_TTL_MS);
    const token = jwt.sign(
      {
        jti: crypto.randomUUID(),
        walletAddress: consumedUser.walletAddress,
        role: consumedUser.role,
        authMethod: "SIWE",
        chainId: Number(siwe.chainId),
        resources: siwe.resources || [],
        siweIssuedAt: siwe.issuedAt,
      },
      process.env.JWT_SECRET,
      {
        audience: JWT_AUDIENCE,
        expiresIn: Math.floor((expiresAt.getTime() - issuedAt.getTime()) / 1000),
        issuer: JWT_ISSUER,
      }
    );

    res.status(200).json({
      success: true,
      message: "SIWE login successful",
      token,
      expiresAt: expiresAt.toISOString(),
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
    if (!jti || !exp) throw createError("Token cannot be revoked", 400);
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
    res.status(200).json({ success: true, message: "Logout successful" });
  } catch (error) {
    next(error);
  }
};

module.exports = { getNonce, logout, walletLogin };
