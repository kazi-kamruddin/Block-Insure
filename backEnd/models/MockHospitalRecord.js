const mongoose = require("mongoose");

const mockHospitalRecordSchema = new mongoose.Schema(
  {
    hospitalId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    hospitalName: {
      type: String,
      required: true,
      trim: true,
      default: "Synthetic General Hospital",
    },
    division: {
      type: String,
      required: true,
      trim: true,
      default: "Dhaka",
      index: true,
    },
    district: {
      type: String,
      required: true,
      trim: true,
      default: "Dhaka",
      index: true,
    },
    hospitalTier: {
      type: String,
      enum: ["PRIMARY", "SECONDARY", "TERTIARY", "SPECIALIZED"],
      default: "SECONDARY",
    },
    licenseStatus: {
      type: String,
      enum: ["ACTIVE", "SUSPENDED", "BLACKLISTED"],
      default: "ACTIVE",
      index: true,
    },
    patientHash: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    patientAgeBand: {
      type: String,
      enum: ["CHILD", "ADULT", "SENIOR"],
      default: "ADULT",
    },
    treatmentType: {
      type: String,
      required: true,
      trim: true,
      default: "HOSPITALIZATION",
      index: true,
    },
    diagnosisCode: {
      type: String,
      required: true,
      trim: true,
      default: "GEN-001",
    },
    admissionDate: {
      type: Date,
      required: true,
    },
    dischargeDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    invoiceDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    billAmount: {
      type: String,
      required: true,
      trim: true,
    },
    expectedBillMin: {
      type: String,
      required: true,
      trim: true,
      default: "0.05",
    },
    expectedBillMax: {
      type: String,
      required: true,
      trim: true,
      default: "1.0",
    },
    invoiceNumber: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    invoiceHash: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    invoiceStatus: {
      type: String,
      enum: ["VALID", "USED", "CANCELLED", "SUSPICIOUS"],
      default: "VALID",
      index: true,
    },
    recordStatus: {
      type: String,
      enum: ["VALID", "INVALID", "USED", "CANCELLED"],
      default: "VALID",
      index: true,
    },
    fraudLabel: {
      type: String,
      enum: [
        "LEGITIMATE",
        "USED_INVOICE",
        "CANCELLED_RECORD",
        "INFLATED_AMOUNT",
        "BLACKLISTED_HOSPITAL",
        "DATE_MISMATCH",
        "SUSPICIOUS_PATTERN",
      ],
      default: "LEGITIMATE",
      index: true,
    },
    fraudSignals: {
      usedInvoice: {
        type: Boolean,
        default: false,
      },
      cancelledRecord: {
        type: Boolean,
        default: false,
      },
      inflatedAmount: {
        type: Boolean,
        default: false,
      },
      blacklistedHospital: {
        type: Boolean,
        default: false,
      },
      dateMismatch: {
        type: Boolean,
        default: false,
      },
    },
    previousClaimCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    syntheticSource: {
      type: String,
      trim: true,
      default: "phase-1-seed-v1",
    },
  },
  { timestamps: true }
);

mockHospitalRecordSchema.index({
  hospitalId: 1,
  invoiceHash: 1,
});

module.exports = mongoose.model("MockHospitalRecord", mockHospitalRecordSchema);
