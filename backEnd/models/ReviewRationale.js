const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  commitment: { type: String, unique: true, required: true },
  scope: { type: String, required: true }, claimId: { type: String, required: true },
  version: { type: Number, required: true }, auditor: { type: String, required: true },
  vote: { type: Number, enum: [1, 2], required: true }, basis: { type: String, required: true },
  nonce: { type: String, required: true },
}, { timestamps: true });
module.exports = mongoose.model("ReviewRationale", schema);
