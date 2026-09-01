const HOSPITAL_NETWORK = Object.freeze([
  {
    hospitalId: "HOSP-001",
    name: "Dhaka Central Medical Hospital",
    division: "Dhaka",
    district: "Dhaka",
    hospitalTier: "TERTIARY",
    walletAddress: "0xbcd4042de499d14e55001ccbb24a551f3b954096",
  },
  {
    hospitalId: "HOSP-002",
    name: "Chattogram Metropolitan Hospital",
    division: "Chattogram",
    district: "Chattogram",
    hospitalTier: "TERTIARY",
    walletAddress: "0x71be63f3384f5fb98995898a86b02fb2426c5788",
  },
  {
    hospitalId: "HOSP-003",
    name: "Rajshahi Community Hospital",
    division: "Rajshahi",
    district: "Rajshahi",
    hospitalTier: "SECONDARY",
    walletAddress: "0xfabb0ac9d68b0b445fb7357272ff202c5651694a",
  },
  {
    hospitalId: "HOSP-004",
    name: "Khulna Riverside Hospital",
    division: "Khulna",
    district: "Khulna",
    hospitalTier: "SECONDARY",
    walletAddress: "0x1cbd3b2770909d4e10f157cabc84c7264073c9ec",
  },
  {
    hospitalId: "HOSP-005",
    name: "Sylhet Valley Hospital",
    division: "Sylhet",
    district: "Sylhet",
    hospitalTier: "SPECIALIZED",
    walletAddress: "0xdf3e18d64bc6a983f673ab319ccae4f1a57c7097",
  },
]);

const getHospitalNetworkEntry = (hospitalId) =>
  HOSPITAL_NETWORK.find((hospital) => hospital.hospitalId === hospitalId);

module.exports = { HOSPITAL_NETWORK, getHospitalNetworkEntry };
