const mongoose = require("mongoose");

const indexedBlockchainEventSchema = new mongoose.Schema(
  {
    contractAddress: { type: String, required: true, lowercase: true, index: true },
    contractName: { type: String, required: true, trim: true, index: true },
    blockNumber: { type: Number, required: true, min: 0, index: true },
    blockHash: { type: String, required: true, index: true },
    transactionHash: { type: String, required: true, index: true },
    logIndex: { type: Number, required: true, min: 0 },
    eventName: { type: String, required: true, index: true },
    args: { type: mongoose.Schema.Types.Mixed, default: {} },
    removed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

indexedBlockchainEventSchema.index(
  { contractAddress: 1, transactionHash: 1, logIndex: 1 },
  { unique: true }
);
indexedBlockchainEventSchema.index({ eventName: 1, blockNumber: -1, logIndex: -1 });

module.exports = mongoose.model("IndexedBlockchainEvent", indexedBlockchainEventSchema);
