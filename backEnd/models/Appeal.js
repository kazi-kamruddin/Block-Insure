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
  },
  { timestamps: true }
);

module.exports = mongoose.model("Appeal", appealSchema);
