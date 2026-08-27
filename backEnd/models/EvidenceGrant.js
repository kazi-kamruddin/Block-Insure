const mongoose = require("mongoose");

const evidenceGrantSchema = new mongoose.Schema(
  {
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "File",
      required: true,
      index: true,
    },
    ownerWallet: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    granteeWallet: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    claimId: { type: String, required: true, index: true },
    claimVersion: { type: Number, required: true, min: 1 },
    transformKey: { type: String, required: true, select: false },
    granteeKeyVersion: { type: Number, required: true, min: 1 },
    revokedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

evidenceGrantSchema.index(
  { documentId: 1, granteeWallet: 1, claimVersion: 1 },
  { unique: true }
);

module.exports = mongoose.model("EvidenceGrant", evidenceGrantSchema);
