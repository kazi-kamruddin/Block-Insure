const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  _id: { type: String, required: true }, contextId: { type: String, required: true, index: true },
  requestId: { type: String, required: true, index: true }, claimId: { type: String, required: true },
  claimVersion: { type: String, required: true }, coordinatorAddress: { type: String, required: true },
  oracleWallet: { type: String, required: true }, oracleInstanceId: { type: String, required: true },
  binding: { type: mongoose.Schema.Types.Mixed, required: true }, result: { type: mongoose.Schema.Types.Mixed, required: true },
  resultHash: { type: String, required: true }, contextHash: { type: String, required: true },
  explanationHash: { type: String, required: true }, metrics: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });
schema.index({ coordinatorAddress: 1, requestId: 1, claimVersion: 1, "binding.requestBlockHash": 1 });
module.exports = mongoose.model("OracleShadowAssessment", schema);
