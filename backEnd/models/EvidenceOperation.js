const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  operationKey: { type: String, required: true, unique: true },
  deploymentScope: { type: String, required: true, index: true },
  transactionHash: { type: String, default: "" },
  signedTransaction: { type: String, default: "", select: false },
  nonce: { type: Number, default: null },
  nonceKey: { type: String },
  signerWallet: { type: String, default: "" },
  status: { type: String, enum: ["PREPARING", "PENDING", "CONFIRMED", "REVERTED"], default: "PREPARING" },
  leaseOwner: { type: String, default: "", select: false },
  leaseUntil: { type: Date, default: null, select: false },
}, { timestamps: true });
schema.index({ nonceKey: 1 }, { unique: true, sparse: true });
module.exports = mongoose.model("EvidenceOperation", schema);
