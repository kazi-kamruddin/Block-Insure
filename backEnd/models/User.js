const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    walletAddress: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
    },
    name: {
      type: String,
      trim: true,
      default: "",
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    hashedNid: {
      type: String,
      trim: true,
      default: "",
    },
    nonce: {
      type: String,
      default: "",
    },
    nonceExpiresAt: {
      type: Date,
      default: null,
    },
    encryptionPublicKey: {
      type: String,
      default: "",
      select: false,
    },
    encryptionSigningPublicKey: {
      type: String,
      default: "",
      select: false,
    },
    encryptedEvidenceIdentityBackup: {
      type: String,
      default: "",
      select: false,
    },
    encryptionKeyVersion: {
      type: Number,
      min: 0,
      default: 0,
    },
    encryptionSchemeVersion: {
      type: String,
      default: "",
    },
    encryptionKeyRevokedAt: {
      type: Date,
      default: null,
    },
    role: {
      type: String,
      enum: ["USER", "ADMIN", "AUDITOR", "ORACLE"],
      default: "USER",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
