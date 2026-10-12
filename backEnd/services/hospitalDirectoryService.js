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
        $set: {
          ...hospital,
          networkStatus: "CONTRACTED",
        },
        $setOnInsert: { joinedAt: new Date() },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );
    await User.findOneAndUpdate(
      { walletAddress: hospital.walletAddress },
      {
        walletAddress: hospital.walletAddress,
        name: hospital.name,
        role: "HOSPITAL",
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
