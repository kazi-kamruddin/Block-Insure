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
    claimVersion: {
      type: Number,
      min: 0,
      default: 0,
      index: true,
    },
    envelopeClaimId: {
      type: String,
      trim: true,
      default: "",
      index: true,
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
    encryptionSchemeVersion: {
      type: String,
      trim: true,
      default: "RECRYPT-RS-0.15+A256GCM",
    },
    keyCapsule: {
      type: String,
      trim: true,
      default: "",
      select: false,
    },
    associatedDataHash: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    authenticatedAssociatedData: {
      type: String,
      trim: true,
      default: "",
      select: false,
    },
    encryptionIdentityVersion: {
      type: Number,
      min: 0,
      default: 0,
    },
    evidenceEventIndex: {
      type: Number,
      min: 0,
      default: null,
      index: true,
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

fileSchema.index(
  { associatedDataHash: 1 },
  {
    unique: true,
    name: "unique_evidence_associated_data",
    partialFilterExpression: { associatedDataHash: { $gt: "" } },
  }
);

module.exports = mongoose.model("File", fileSchema);
