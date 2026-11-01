const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  challengeId: { type: String, required: true, unique: true },
  walletAddress: { type: String, required: true, lowercase: true, index: true },
  email: { type: String, required: true },
  deliveryMode: { type: String, enum: ["simulation", "brevo"], required: true },
  otpHash: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
  status: { type: String, enum: ["PENDING", "USED", "FAILED", "EXPIRED", "LOCKED"], default: "PENDING" },
}, { timestamps: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });
module.exports = mongoose.model("EmailChallenge", schema);
