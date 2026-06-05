const mongoose = require("mongoose");

const votingFinalizationSchema = new mongoose.Schema(
  {
    claimId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    consensus: {
      type: String,
      required: true,
      enum: ["VALID", "INVALID", "NEEDS_MORE"],
    },
    consensusCode: {
      type: Number,
      required: true,
      min: 1,
      max: 3,
    },
    consensusStrength: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    totalVoters: {
      type: Number,
      required: true,
      min: 1,
    },
    voters: [
      {
        auditorAddress: {
          type: String,
          required: true,
          lowercase: true,
          trim: true,
        },
        vote: {
          type: Number,
          required: true,
        },
        voteLabel: {
          type: String,
          required: true,
        },
        reputationAtFinalization: {
          type: Number,
          required: true,
        },
        votedWithConsensus: {
          type: Boolean,
          required: true,
        },
      },
    ],
    reputationTransactionHashes: {
      type: [String],
      default: [],
    },
    finalizedBy: {
      type: String,
      lowercase: true,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("VotingFinalization", votingFinalizationSchema);
