const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  deploymentScope: { type: String, required: true }, claimId: { type: String, required: true },
  claimVersion: { type: Number, required: true }, ownerWallet: { type: String, required: true, lowercase: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true, select: false },
  appealReasonHash: { type: String, default: "" }, transactionHash: { type: String, default: "" },
  lastRevertedTransactionHash: { type: String, default: "" },
  startBlock: { type: Number, required: true },
  status: { type: String, enum: ["DRAFT", "READY", "TX_SUBMITTED", "COMPLETED", "REVERTED"], default: "DRAFT" },
}, { timestamps: true });
schema.index({ deploymentScope: 1, claimId: 1, claimVersion: 1 }, { unique: true });
module.exports = mongoose.model("AppealSubmissionAttempt", schema);
