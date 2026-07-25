const mongoose = require("mongoose");

const appealSchema = new mongoose.Schema(
  {
    claimId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    claimantWallet: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    appealReason: {
      type: String,
      required: true,
      trim: true,
    },
    reasonCategory: {
      type: String,
      trim: true,
      default: "OTHER",
      index: true,
    },
    appealDescription: {
      type: String,
      trim: true,
      default: "",
    },
    appealReasonHash: {
      type: String,
      required: true,
      trim: true,
    },
    additionalDocumentHash: {
      type: String,
      trim: true,
      default: "",
    },
    additionalDocumentCID: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: ["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED"],
      default: "PENDING",
      index: true,
    },
    adminNote: {
      type: String,
      trim: true,
      default: "",
    },
    auditorRecommendation: {
      type: String,
      trim: true,
      default: "",
    },
    finalRejectionReason: {
      type: String,
      trim: true,
      default: "",
    },
    appealDeadline: {
      type: Date,
      default: null,
    },
    history: {
      type: [
        {
          status: { type: String, trim: true },
          actorWallet: { type: String, trim: true, lowercase: true, default: "" },
          actorRole: { type: String, trim: true, default: "" },
          note: { type: String, trim: true, default: "" },
          timestamp: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    transactionHash: {
      type: String,
      trim: true,
      default: "",
    },
    submittedAt: {
      type: Date,
      default: Date.now,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewOperationStatus: {
      type: String,
      enum: ["IDLE", "PROCESSING", "CHAIN_CONFIRMED", "COMPLETED", "FAILED"],
      default: "IDLE",
      index: true,
    },
    reviewDesiredStatus: {
      type: String,
      enum: ["", "APPROVED", "REJECTED"],
      default: "",
    },
    reviewTransactionHash: {
      type: String,
      trim: true,
      default: "",
    },
    reviewLockExpiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    reviewFailureReason: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Appeal", appealSchema);
