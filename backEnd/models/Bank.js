const mongoose = require("mongoose");

const bankSchema = new mongoose.Schema(
  {
    bankId: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    walletAddress: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    routingCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
    currency: { type: String, enum: ["BDT"], default: "BDT" },
    operatingStatus: {
      type: String,
      enum: ["ACTIVE", "SUSPENDED", "CLOSED"],
      default: "ACTIVE",
      index: true,
    },
    joinedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Bank", bankSchema);
