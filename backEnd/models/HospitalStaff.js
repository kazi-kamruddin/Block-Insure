const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  displayName: { type: String, required: true, trim: true, maxlength: 100 },
  hospitalId: { type: String, required: true, uppercase: true, trim: true, index: true },
  passwordHash: { type: String, required: true, select: false },
  active: { type: Boolean, default: true },
  sessionVersion: { type: Number, default: 1, select: false },
  failedLogins: { type: Number, default: 0, select: false },
  lockedUntil: { type: Date, default: null, select: false },
}, { timestamps: true });

module.exports = mongoose.model("HospitalStaff", schema);
