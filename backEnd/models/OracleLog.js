const mongoose = require("mongoose");

const oracleLogSchema = new mongoose.Schema(
  {
    requestId: {
      type: String,
      required: true,
      index: true,
    },
    claimId: {
      type: String,
      required: true,
      index: true,
    },
    oracleType: {
      type: String,
      required: true,
      trim: true,
      default: "HOSPITAL",
    },
    queryData: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    responseData: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    resultHash: {
      type: String,
      required: true,
      trim: true,
    },
    verified: {
      type: Boolean,
      required: true,
    },
    riskLevel: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "FRAUD_FLAGGED", "ORACLE_FAILED"],
      default: "MEDIUM",
    },
    remarks: {
      type: String,
      trim: true,
      default: "",
    },
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
    },
    submittedTxHash: {
      type: String,
      trim: true,
      default: "",
    },
    responseTimeMs: {
      type: Number,
      min: 0,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("OracleLog", oracleLogSchema);
