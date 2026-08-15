const mongoose = require("mongoose");

const evidenceTreeHeadSchema = new mongoose.Schema(
  {
    treeSize: { type: Number, required: true, min: 1, unique: true, index: true },
    rootHash: { type: String, required: true, trim: true, index: true },
    previousRootHash: { type: String, trim: true, default: "" },
    signerWallet: { type: String, required: true, lowercase: true, trim: true },
    signature: { type: String, required: true },
    anchorTransactionHash: { type: String, trim: true, default: "", index: true },
    anchorBlockNumber: { type: Number, min: 0, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("EvidenceTreeHead", evidenceTreeHeadSchema);
