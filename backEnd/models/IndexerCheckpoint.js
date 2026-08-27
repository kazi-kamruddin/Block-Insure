const mongoose = require("mongoose");

const indexerCheckpointSchema = new mongoose.Schema(
  {
    indexerId: { type: String, required: true, unique: true },
    contractAddress: { type: String, required: true, lowercase: true },
    blockNumber: { type: Number, required: true, min: 0 },
    blockHash: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("IndexerCheckpoint", indexerCheckpointSchema);
