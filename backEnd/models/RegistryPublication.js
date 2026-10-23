const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  status: { type: String, enum: ["PENDING", "PUBLISHED"], default: "PENDING", index: true },
  rootHash: { type: String, default: "" },
  transactionHash: { type: String, default: "" },
  lastError: { type: String, default: "" },
}, { timestamps: true });
module.exports = mongoose.model("RegistryPublication", schema);
