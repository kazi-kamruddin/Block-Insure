const mongoose = require("mongoose");

const revokedTokenSchema = new mongoose.Schema(
  {
    jti: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    walletAddress: {
      type: String,
      lowercase: true,
      trim: true,
      default: "",
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("RevokedToken", revokedTokenSchema);
