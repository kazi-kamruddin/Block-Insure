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
    encrypted: {
      type: Boolean,
      default: false,
      index: true,
    },
    encryptionAlgorithm: {
      type: String,
      trim: true,
      default: "",
    },
    originalMimeType: {
      type: String,
      trim: true,
      default: "",
    },
    keyProvider: {
      type: String,
      trim: true,
      default: "",
    },
    keyId: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    wrappedEvidenceKey: {
      type: String,
      trim: true,
      default: "",
      select: false,
    },
    previousEvidenceHash: {
      type: String,
      trim: true,
      default: "",
    },
    evidenceChainHash: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    evidenceChainIndex: {
      type: Number,
      min: 0,
      default: null,
    },
  },
  { timestamps: true }
);

fileSchema.index({
  claimId: 1,
  evidenceChainIndex: 1,
  createdAt: 1,
});
fileSchema.index(
  { claimId: 1, evidenceChainIndex: 1 },
  {
    unique: true,
    name: "unique_claim_evidence_chain_index",
    partialFilterExpression: {
      claimId: { $gt: "" },
      evidenceChainIndex: { $type: "number" },
    },
  }
);

module.exports = mongoose.model("File", fileSchema);
