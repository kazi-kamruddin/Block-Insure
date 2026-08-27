const mongoose = require("mongoose");

const adminActionLogSchema = new mongoose.Schema(
  {
    actorWallet: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
      index: true,
    },
    actorRole: {
      type: String,
      trim: true,
      default: "",
    },
    action: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    targetType: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    targetId: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    transactionHash: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    blockNumber: {
      type: Number,
      default: null,
    },
    request: {
      ip: { type: String, default: "" },
      method: { type: String, default: "" },
      path: { type: String, default: "" },
      userAgent: { type: String, default: "" },
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

adminActionLogSchema.index(
  { transactionHash: 1, action: 1 },
  {
    unique: true,
    partialFilterExpression: { transactionHash: { $gt: "" } },
  }
);

module.exports = mongoose.model("AdminActionLog", adminActionLogSchema);
