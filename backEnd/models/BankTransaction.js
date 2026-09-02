const mongoose = require("mongoose");

const bankTransactionSchema = new mongoose.Schema(
  {
    transactionId: { type: String, required: true, unique: true, trim: true, index: true },
    bankId: { type: String, required: true, uppercase: true, trim: true, index: true },
    accountReference: { type: String, required: true, uppercase: true, trim: true },
    ownerWalletAddress: { type: String, required: true, lowercase: true, trim: true, index: true },
    policyId: { type: String, required: true, trim: true, index: true },
    mandateId: { type: String, trim: true, default: "", index: true },
    type: { type: String, enum: ["EFT", "MANUAL_OTP"], required: true },
    status: { type: String, enum: ["PROCESSING", "PAID", "FAILED"], default: "PROCESSING", index: true },
    amountMinor: { type: Number, required: true, min: 1 },
    amountWei: { type: String, required: true, trim: true },
    currency: { type: String, enum: ["BDT"], default: "BDT" },
    dueAt: { type: Date, required: true },
    completedAt: { type: Date, default: null },
    transactionHash: { type: String, lowercase: true, trim: true, default: "", index: true },
    failureReason: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

bankTransactionSchema.index({ bankId: 1, createdAt: -1 });
bankTransactionSchema.index({ ownerWalletAddress: 1, createdAt: -1 });

module.exports = mongoose.model("BankTransaction", bankTransactionSchema);
