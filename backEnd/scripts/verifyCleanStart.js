require("dotenv").config();

const dns = require("dns");
const mongoose = require("mongoose");
const { ethers } = require("ethers");
const InsuranceManagerArtifact = require("../abi/InsuranceManager.json");
const AdminActionLog = require("../models/AdminActionLog");
const Appeal = require("../models/Appeal");
const ClaimSubmissionAttempt = require("../models/ClaimSubmissionAttempt");
const File = require("../models/File");
const MockHospitalRecord = require("../models/MockHospitalRecord");
const MockHospitalRecordOracle2 = require("../models/MockHospitalRecordOracle2");
const Notification = require("../models/Notification");
const OracleHealth = require("../models/OracleHealth");
const OracleLog = require("../models/OracleLog");
const RevokedToken = require("../models/RevokedToken");
const User = require("../models/User");
const VotingFinalization = require("../models/VotingFinalization");
const { buildSyntheticRecords } = require("./seedMockData");

dns.setDefaultResultOrder("ipv4first");

if (process.env.FORCE_PUBLIC_DNS === "true") {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
}

function requireEnv(name) {
  if (!process.env[name]) {
    throw new Error(`${name} is missing in backend/.env`);
  }

  return process.env[name];
}

async function main() {
  const provider = new ethers.JsonRpcProvider(requireEnv("RPC_URL"));
  const contract = new ethers.Contract(
    requireEnv("VITE_CONTRACT_ADDRESS"),
    InsuranceManagerArtifact.abi,
    provider
  );

  const [packageIds, policyCounter, claimCounter, reserveWei] = await Promise.all([
    contract.getAllPackageIds(),
    contract.policyCounter(),
    contract.claimCounter(),
    provider.getBalance(requireEnv("VITE_CONTRACT_ADDRESS")),
  ]);

  const failures = [];
  if (packageIds.length !== 1) failures.push(`expected 1 package, found ${packageIds.length}`);
  if (policyCounter !== 1n) failures.push(`expected 0 purchased policies, found ${policyCounter - 1n}`);
  if (claimCounter !== 1n) failures.push(`expected 0 claims, found ${claimCounter - 1n}`);
  if (reserveWei < ethers.parseEther("1")) {
    failures.push(`expected at least 1 ETH settlement reserve, found ${ethers.formatEther(reserveWei)} ETH`);
  }

  const registryRoot = await contract.registryMerkleRoot();
  if (registryRoot === ethers.ZeroHash) failures.push("expected a published healthcare registry Merkle root");

  await mongoose.connect(requireEnv("MONGODB_URI"));
  try {
    const checks = [
      ["admin action logs", AdminActionLog],
      ["appeals", Appeal],
      ["claim submission attempts", ClaimSubmissionAttempt],
      ["documents", File],
      ["notifications", Notification],
      ["oracle health records", OracleHealth],
      ["oracle logs", OracleLog],
      ["revoked sessions", RevokedToken],
      ["voting finalizations", VotingFinalization],
    ];

    for (const [label, Model] of checks) {
      const count = await Model.countDocuments({});
      if (count !== 0) failures.push(`expected 0 ${label}, found ${count}`);
    }

    const expectedRegistryCount = buildSyntheticRecords().length;
    const [primaryRegistryCount, oracle2RegistryCount] = await Promise.all([
      MockHospitalRecord.countDocuments({}),
      MockHospitalRecordOracle2.countDocuments({}),
    ]);
    if (primaryRegistryCount !== expectedRegistryCount) {
      failures.push(`expected ${expectedRegistryCount} primary registry records, found ${primaryRegistryCount}`);
    }
    if (oracle2RegistryCount !== expectedRegistryCount) {
      failures.push(`expected ${expectedRegistryCount} oracle 2 registry records, found ${oracle2RegistryCount}`);
    }

    const userCount = await User.countDocuments({});
    if (userCount < 2) failures.push(`expected configured role users, found ${userCount}`);
  } finally {
    await mongoose.connection.close();
    provider.destroy();
  }

  if (failures.length > 0) {
    throw new Error(`Clean-start verification failed: ${failures.join("; ")}`);
  }

  console.log("Clean-start verification passed: 1 package, 0 purchased policies/claims, funded settlement reserve, no prior runtime activity, and a published healthcare registry baseline.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
