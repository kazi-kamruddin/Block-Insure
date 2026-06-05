const MockHospitalRecord = require("../models/MockHospitalRecord");
const MockHospitalRecordOracle2 = require("../models/MockHospitalRecordOracle2");

const normalizeRegistrySnapshot = (value) => {
  return String(value || "primary").trim().toLowerCase() === "oracle2"
    ? "oracle2"
    : "primary";
};

const getRegistryModel = (snapshot) => {
  return normalizeRegistrySnapshot(snapshot) === "oracle2"
    ? MockHospitalRecordOracle2
    : MockHospitalRecord;
};

module.exports = {
  getRegistryModel,
  normalizeRegistrySnapshot,
};
