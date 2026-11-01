const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  deploymentScope: { type: String, required: true }, claimId: { type: String, required: true },
  claimVersion: { type: Number, required: true }, manifestHash: { type: String, required: true },
  ownerWallet: { type: String, required: true }, grantCommitment: { type: String, required: true },
  grants: { type: [mongoose.Schema.Types.Mixed], required: true, select: false },
  status: { type: String, enum: ["PREPARED", "ACTIVE", "EXPIRED", "STALE"], default: "PREPARED" },
}, { timestamps: true });
schema.index({ deploymentScope: 1, claimId: 1, claimVersion: 1 }, { unique: true });
module.exports = mongoose.model("ReviewAccessBatch", schema);
