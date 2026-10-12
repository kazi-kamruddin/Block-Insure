const mongoose = require("mongoose");

const hospitalClaimVerificationSchema = new mongoose.Schema(
  {
    claimId: { type: String, required: true, trim: true, index: true },
    claimVersion: { type: Number, required: true, min: 1 },
    hospitalId: { type: String, required: true, trim: true, uppercase: true, index: true },
    hospitalWallet: { type: String, required: true, trim: true, lowercase: true },
    recordId: { type: mongoose.Schema.Types.ObjectId, ref: "MockHospitalRecord", default: null },
    invoiceHash: { type: String, required: true, trim: true, lowercase: true },
    outcome: {
      type: String,
      enum: ["VERIFIED", "MISMATCHED", "NOT_FOUND"],
      required: true,
      index: true,
    },
    verified: { type: Boolean, required: true, index: true },
    checks: {
      invoiceFound: { type: Boolean, required: true },
      invoiceHashMatches: { type: Boolean, required: true },
      amountMatches: { type: Boolean, required: true },
      incidentWithinCareDates: { type: Boolean, required: true },
      treatmentMatches: { type: Boolean, required: true },
      recordEligible: { type: Boolean, required: true },
    },
    claimSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    recordSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    attestationHash: { type: String, required: true, trim: true, lowercase: true },
    transactionHash: { type: String, required: true, trim: true, lowercase: true, unique: true },
    blockNumber: { type: Number, required: true, min: 0 },
    note: { type: String, trim: true, maxlength: 500, default: "" },
    verifiedAt: { type: Date, required: true },
  },
  { timestamps: true }
);

hospitalClaimVerificationSchema.index(
  { claimId: 1, claimVersion: 1 },
  { unique: true }
);

module.exports = mongoose.model(
  "HospitalClaimVerification",
  hospitalClaimVerificationSchema
);
