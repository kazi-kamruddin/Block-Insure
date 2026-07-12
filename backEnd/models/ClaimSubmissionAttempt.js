const mongoose = require("mongoose");

const claimSubmissionAttemptSchema = new mongoose.Schema(
  {
    walletAddress: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    policyId: {
      type: String,
      required: true,
      trim: true,
    },
    claimId: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    documentId: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: ["AUTHORIZED", "COMPLETED"],
      default: "AUTHORIZED",
      index: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  { timestamps: true }
);

claimSubmissionAttemptSchema.index({ walletAddress: 1, createdAt: -1 });

module.exports = mongoose.model(
  "ClaimSubmissionAttempt",
  claimSubmissionAttemptSchema
);
