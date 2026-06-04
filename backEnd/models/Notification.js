const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    recipientRole: {
      type: String,
      enum: ["", "ADMIN"],
      default: "",
      index: true,
    },
    recipientWallet: {
      type: String,
      lowercase: true,
      trim: true,
      default: "",
      index: true,
    },
    actorWallet: {
      type: String,
      lowercase: true,
      trim: true,
      default: "",
    },
    type: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    claimId: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    appealId: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      trim: true,
      default: "",
    },
    link: {
      type: String,
      trim: true,
      default: "",
    },
    dedupeKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    readAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Notification", notificationSchema);
