const mongoose = require("mongoose");

const evidenceAccessLogSchema = new mongoose.Schema(
  {
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "File",
      required: true,
      index: true,
    },
    claimId: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    actorWallet: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    actorRole: {
      type: String,
      required: true,
      trim: true,
    },
    action: {
      type: String,
      enum: ["UNWRAP_KEY"],
      default: "UNWRAP_KEY",
    },
    userAgent: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("EvidenceAccessLog", evidenceAccessLogSchema);
