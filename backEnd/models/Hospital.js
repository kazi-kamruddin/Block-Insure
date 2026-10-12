const mongoose = require("mongoose");

const hospitalSchema = new mongoose.Schema(
  {
    hospitalId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    walletAddress: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    division: { type: String, required: true, trim: true },
    district: { type: String, required: true, trim: true },
    hospitalTier: {
      type: String,
      enum: ["PRIMARY", "SECONDARY", "TERTIARY", "SPECIALIZED"],
      required: true,
    },
    networkStatus: {
      type: String,
      enum: ["CONTRACTED", "SUSPENDED", "TERMINATED"],
      default: "CONTRACTED",
      index: true,
    },
    joinedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Hospital", hospitalSchema);
