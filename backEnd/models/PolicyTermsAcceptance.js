const mongoose = require("mongoose");

const policyTermsAcceptanceSchema = new mongoose.Schema(
  {
    walletAddress: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    packageId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    documentVersion: {
      type: String,
      required: true,
      trim: true,
    },
    documentHash: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    acceptedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  { timestamps: true }
);

policyTermsAcceptanceSchema.index(
  { walletAddress: 1, packageId: 1, documentHash: 1 },
  { unique: true }
);

module.exports = mongoose.model(
  "PolicyTermsAcceptance",
  policyTermsAcceptanceSchema
);
