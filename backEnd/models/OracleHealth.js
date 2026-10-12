const mongoose = require("mongoose");

const oracleHealthSchema = new mongoose.Schema(
  {
    oracleWallet: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
      index: true,
    },
    oracleInstanceId: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    label: {
      type: String,
      trim: true,
      default: "",
    },
    registrySnapshot: {
      type: String,
      trim: true,
      default: "",
    },
    registryRoot: {
      type: String,
      trim: true,
      default: "",
    },
    lastHeartbeatAt: {
      type: Date,
      default: null,
      index: true,
    },
    lastProcessedRequestId: {
      type: String,
      trim: true,
      default: "",
    },
    lastProcessedClaimId: {
      type: String,
      trim: true,
      default: "",
    },
    lastTxHash: {
      type: String,
      trim: true,
      default: "",
    },
    configIdentity: {
      type: String,
      trim: true,
      default: "",
    },
    cursorChainId: {
      type: String,
      trim: true,
      default: "",
    },
    cursorContractAddress: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    nextBlock: {
      type: Number,
      min: 0,
      default: null,
    },
    cursorUpdatedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

oracleHealthSchema.index(
  { oracleWallet: 1, oracleInstanceId: 1 },
  { unique: true, sparse: true }
);

module.exports = mongoose.model("OracleHealth", oracleHealthSchema);
