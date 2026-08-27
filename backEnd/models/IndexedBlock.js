const mongoose = require("mongoose");

const indexedBlockSchema = new mongoose.Schema(
  {
    indexerId: { type: String, required: true, index: true },
    blockNumber: { type: Number, required: true, min: 0 },
    blockHash: { type: String, required: true, index: true },
    parentHash: { type: String, required: true },
  },
  { timestamps: true }
);

indexedBlockSchema.index({ indexerId: 1, blockNumber: 1 }, { unique: true });

module.exports = mongoose.model("IndexedBlock", indexedBlockSchema);
