const mongoose = require("mongoose");

const bankOtpChallengeSchema = new mongoose.Schema(
  {
    challengeId: { type: String, required: true, unique: true, trim: true },
    ownerWalletAddress: { type: String, required: true, lowercase: true, trim: true, index: true },
    accountReference: { type: String, required: true, uppercase: true, trim: true },
    policyId: { type: String, required: true, trim: true },
    deploymentScope: { type: String, default: "" },
    installmentId: { type: String, default: "" },
    amountWei: { type: String, default: "" },
    amountMinor: { type: Number, default: null },
    otpHash: { type: String, required: true, select: false },
    deliveryMode: { type: String, enum: ["simulation", "brevo"], default: "simulation" },
    expiresAt: { type: Date, required: true, index: true },
    attempts: { type: Number, min: 0, default: 0 },
    status: { type: String, enum: ["PENDING", "USED", "EXPIRED", "LOCKED", "FAILED"], default: "PENDING" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("BankOtpChallenge", bankOtpChallengeSchema);
