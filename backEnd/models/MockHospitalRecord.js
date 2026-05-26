const mongoose = require("mongoose");

const mockHospitalRecordSchema = new mongoose.Schema(
  {
    hospitalId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    patientHash: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    admissionDate: {
      type: Date,
      required: true,
    },
    billAmount: {
      type: String,
      required: true,
      trim: true,
    },
    invoiceHash: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    recordStatus: {
      type: String,
      enum: ["VALID", "INVALID", "USED", "CANCELLED"],
      default: "VALID",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("MockHospitalRecord", mockHospitalRecordSchema);