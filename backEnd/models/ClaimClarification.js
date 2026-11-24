const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  scope: { type: String, required: true }, claimId: { type: String, required: true },
  priorVersion: { type: Number, required: true }, owner: { type: String, required: true },
  requestedBy: { type: String, required: true }, question: { type: String, required: true },
  deadline: { type: Number, required: true }, manifestHash: String, statement: mongoose.Schema.Types.Mixed,
  documentIds: [String], confirmed: { type: Boolean, default: false },
  deadlineNoticeAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ scope: 1, claimId: 1 }, { unique: true });
schema.index({ scope: 1, confirmed: 1, deadlineNoticeAt: 1, deadline: 1 });
module.exports = mongoose.model("ClaimClarification", schema);
