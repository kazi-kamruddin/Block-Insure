const mongoose = require("mongoose");
module.exports = mongoose.model("EvidenceLogLock", new mongoose.Schema({
  _id: String, owner: String, expiresAt: Date,
}));
