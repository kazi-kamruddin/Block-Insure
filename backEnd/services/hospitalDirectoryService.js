const Hospital = require("../models/Hospital");
const User = require("../models/User");
const { HOSPITAL_NETWORK } = require("../config/hospitalNetwork");

const formatHospital = (hospital) => ({
  hospitalId: hospital.hospitalId,
  name: hospital.name,
  walletAddress: hospital.walletAddress,
  division: hospital.division,
  district: hospital.district,
  hospitalTier: hospital.hospitalTier,
  networkStatus: hospital.networkStatus,
  joinedAt: hospital.joinedAt,
});

const seedHospitalDirectory = async () => {
  for (const hospital of HOSPITAL_NETWORK) {
    await Hospital.findOneAndUpdate(
      { hospitalId: hospital.hospitalId },
      {
        $setOnInsert: { ...hospital, networkStatus: "CONTRACTED", joinedAt: new Date() },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );
  }

  return Hospital.find({}).sort({ hospitalId: 1 }).lean();
};

const findHospitalByWallet = (walletAddress) =>
  Hospital.findOne({ walletAddress: String(walletAddress || "").toLowerCase() });

module.exports = {
  findHospitalByWallet,
  formatHospital,
  seedHospitalDirectory,
};
