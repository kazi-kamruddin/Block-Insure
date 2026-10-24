const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  _id: String, nextAllowedAt: Date, windowStart: Date, count: Number,
});
schema.index({ nextAllowedAt: 1 }, { expireAfterSeconds: 86400 });
module.exports = mongoose.model("OtpDeliverySlot", schema);
