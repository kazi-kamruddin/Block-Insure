const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  indexerId: { type: String, required: true },
  kind: { type: String, enum: ["claim", "policy", "benefit"], required: true },
  entityId: { type: String, required: true },
  blockNumber: { type: Number, required: true },
  blockHash: { type: String, required: true },
  data: { type: mongoose.Schema.Types.Mixed, required: true },
});
schema.index({ indexerId: 1, kind: 1, entityId: 1, blockNumber: 1 }, { unique: true });
module.exports = mongoose.model("ChainReadSnapshot", schema);
