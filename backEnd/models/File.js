const mongoose = require("mongoose");

const fileSchema = new mongoose.Schema(
  {
    claimId: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    uploaderWallet: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    originalName: {
      type: String,
      required: true,
      trim: true,
    },
    mimeType: {
      type: String,
      required: true,
      trim: true,
    },
    sha256Hash: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    ipfsCID: {
      type: String,
      required: true,
      trim: true,
    },
    documentType: {
      type: String,
      trim: true,
      default: "CLAIM_DOCUMENT",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("File", fileSchema);