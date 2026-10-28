const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  deploymentScope: { type: String, required: true },
  claimId: { type: String, required: true },
  claimVersion: { type: Number, required: true, min: 1 },
  ownerWallet: { type: String, required: true, lowercase: true },
  documentIds: { type: [String], required: true },
  manifest: { type: String, required: true },
  manifestHash: { type: String, required: true },
}, { timestamps: true });
schema.index({ deploymentScope: 1, claimId: 1, claimVersion: 1 }, { unique: true });
module.exports = mongoose.model("EvidenceBundle", schema);
