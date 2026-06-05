const mongoose = require("mongoose");
const MockHospitalRecord = require("./MockHospitalRecord");

module.exports = mongoose.model(
  "MockHospitalRecordOracle2",
  MockHospitalRecord.schema.clone(),
  "mockhospitalrecordoracle2"
);
