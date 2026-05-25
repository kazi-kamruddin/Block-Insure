const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { verifyMessage, getAddress } = require("ethers");
const User = require("../models/User");

const normalizeWalletAddress = (walletAddress) => {
  return getAddress(walletAddress).toLowerCase();
};

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

    const user = await User.findOneAndUpdate(
      { walletAddress },
      {
        walletAddress,
        nonce,
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

    const message = `Block-Insure login nonce: ${user.nonce}`;
    const recoveredAddress = verifyMessage(message, signature).toLowerCase();

    if (recoveredAddress !== normalizedWallet) {
      throw createError("Invalid wallet signature", 401);
    }

    user.nonce = "";
    await user.save();

    const token = jwt.sign(
      {
        walletAddress: user.walletAddress,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(200).json({
      success: true,
      message: "Wallet login successful",
      token,
      user: {
        walletAddress: user.walletAddress,
        role: user.role,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getNonce,
  walletLogin,
};