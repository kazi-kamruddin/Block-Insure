const mongoose = require("mongoose");
// Immutable advisory evidence, deliberately separate from chain claim state.
const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  assessmentId: { type: String, required: true, unique: true },
  deploymentId: { type: String, required: true, index: true },
  claimId: { type: String, required: true, index: true },
  claimVersion: { type: String, required: true },
  assessment: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });
module.exports = mongoose.model("ClaimAdvisoryAssessment", schema);
