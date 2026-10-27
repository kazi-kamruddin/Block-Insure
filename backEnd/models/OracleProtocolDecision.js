const mongoose = require("mongoose");
const schema = new mongoose.Schema({ _id: String, requestId: String, claimVersion: String, modelIdentity: String,
  requestBlockHash: String, coordinatorAddress: String, chainId: String, oracleWallet: String,
  assessment: mongoose.Schema.Types.Mixed }, { timestamps: true });
schema.index({ coordinatorAddress: 1, chainId: 1, requestId: 1 });
module.exports = mongoose.model("OracleProtocolDecision", schema);
