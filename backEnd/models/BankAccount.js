const mongoose = require("mongoose");

const bankAccountSchema = new mongoose.Schema(
  {
    bankId: { type: String, required: true, uppercase: true, trim: true, index: true },
    accountReference: { type: String, required: true, unique: true, uppercase: true, trim: true },
    ownerWalletAddress: { type: String, required: true, lowercase: true, trim: true, index: true },
    accountHolderName: { type: String, required: true, trim: true },
    lastFour: { type: String, required: true, match: /^\d{4}$/ },
    currency: { type: String, enum: ["BDT"], default: "BDT" },
    balanceMinor: { type: Number, required: true, min: 0, default: 0 },
    status: { type: String, enum: ["ACTIVE", "FROZEN", "CLOSED"], default: "ACTIVE", index: true },
  },
  { timestamps: true }
);

bankAccountSchema.index({ bankId: 1, ownerWalletAddress: 1 });

module.exports = mongoose.model("BankAccount", bankAccountSchema);
