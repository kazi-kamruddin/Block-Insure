const mongoose = require("mongoose");

const bankOtpChallengeSchema = new mongoose.Schema(
  {
    challengeId: { type: String, required: true, unique: true, trim: true, index: true },
    ownerWalletAddress: { type: String, required: true, lowercase: true, trim: true, index: true },
    accountReference: { type: String, required: true, uppercase: true, trim: true },
    policyId: { type: String, required: true, trim: true },
    otpHash: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true, index: true },
    attempts: { type: Number, min: 0, default: 0 },
    status: { type: String, enum: ["PENDING", "USED", "EXPIRED", "LOCKED"], default: "PENDING" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("BankOtpChallenge", bankOtpChallengeSchema);
