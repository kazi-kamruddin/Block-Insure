const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  scope: { type: String, required: true }, claimId: { type: String, required: true },
  priorVersion: { type: Number, required: true }, owner: { type: String, required: true },
  requestedBy: { type: String, required: true }, question: { type: String, required: true },
  deadline: { type: Number, required: true }, manifestHash: String, statement: mongoose.Schema.Types.Mixed,
  documentIds: [String], confirmed: { type: Boolean, default: false },
}, { timestamps: true });
schema.index({ scope: 1, claimId: 1 }, { unique: true });
module.exports = mongoose.model("ClaimClarification", schema);
