const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  rootHash: { type: String, required: true, index: true },
  chunkIndex: { type: Number, required: true },
  records: { type: [mongoose.Schema.Types.Mixed], required: true },
});
schema.index({ rootHash: 1, chunkIndex: 1 }, { unique: true });
module.exports = mongoose.model("RegistrySnapshotChunk", schema);
