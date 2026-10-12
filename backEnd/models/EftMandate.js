const mongoose = require("mongoose");

const eftMandateSchema = new mongoose.Schema(
  {
    mandateId: { type: String, required: true, unique: true, trim: true },
    bankId: { type: String, required: true, uppercase: true, trim: true, index: true },
    accountReference: { type: String, required: true, uppercase: true, trim: true },
    policyId: { type: String, required: true, trim: true, index: true },
    ownerWalletAddress: { type: String, required: true, lowercase: true, trim: true, index: true },
    activeInstructionKey: { type: String, trim: true, unique: true, sparse: true },
    destinationReference: { type: String, required: true, trim: true },
    amountMinor: { type: Number, required: true, min: 1 },
    currency: { type: String, enum: ["BDT"], default: "BDT" },
    frequency: { type: String, enum: ["QUARTERLY"], default: "QUARTERLY" },
    validFrom: { type: Date, required: true },
    validUntil: { type: Date, required: true },
    status: {
      type: String,
      enum: ["PENDING_BANK_APPROVAL", "ACTIVE", "EXPIRED", "CANCELLED", "REJECTED"],
      default: "PENDING_BANK_APPROVAL",
      index: true,
    },
    approvedAt: { type: Date, default: null },
    approvedByWallet: { type: String, lowercase: true, trim: true, default: "" },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, maxlength: 500, default: "" },
    cancelledAt: { type: Date, default: null },
    nextDebitAt: { type: Date, default: null, index: true },
    lastReminderAt: { type: Date, default: null },
    lastDebitedAt: { type: Date, default: null },
    lastAttemptAt: { type: Date, default: null },
    lastTransactionReference: { type: String, trim: true, default: "" },
    debitCount: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true }
);

eftMandateSchema.index({ bankId: 1, status: 1 });
eftMandateSchema.index({ ownerWalletAddress: 1, policyId: 1 });
eftMandateSchema.index({ status: 1, nextDebitAt: 1 });

module.exports = mongoose.model("EftMandate", eftMandateSchema);
