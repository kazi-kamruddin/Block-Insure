require("dotenv").config();

const dns = require("dns");
const fs = require("fs");
const mongoose = require("mongoose");
const path = require("path");
const { ethers } = require("ethers");
const AdminActionLog = require("../models/AdminActionLog");
const Appeal = require("../models/Appeal");
const ClaimSubmissionAttempt = require("../models/ClaimSubmissionAttempt");
const EvidenceAccessLog = require("../models/EvidenceAccessLog");
const EvidenceEvent = require("../models/EvidenceEvent");
const EvidenceGrant = require("../models/EvidenceGrant");
const EvidenceTreeHead = require("../models/EvidenceTreeHead");
const File = require("../models/File");
const MockHospitalRecord = require("../models/MockHospitalRecord");
const MockHospitalRecordOracle2 = require("../models/MockHospitalRecordOracle2");
const Notification = require("../models/Notification");
const OracleHealth = require("../models/OracleHealth");
const OracleLog = require("../models/OracleLog");
const RevokedToken = require("../models/RevokedToken");
const User = require("../models/User");
const VotingFinalization = require("../models/VotingFinalization");
const IndexedBlock = require("../models/IndexedBlock");
const IndexedBlockchainEvent = require("../models/IndexedBlockchainEvent");
const IndexerCheckpoint = require("../models/IndexerCheckpoint");
const {
  buildSyntheticRecords,
} = require("./seedMockData");
const { buildHybridRuntimeRecords } = require("./seedHybridData");

dns.setDefaultResultOrder("ipv4first");

if (process.env.FORCE_PUBLIC_DNS === "true") {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
}

const collections = [
  ["admin action logs", AdminActionLog],
  ["appeals", Appeal],
  ["claim submission attempts", ClaimSubmissionAttempt],
  ["documents", File],
  ["evidence access logs", EvidenceAccessLog],
  ["evidence events", EvidenceEvent],
  ["evidence grants", EvidenceGrant],
  ["evidence tree heads", EvidenceTreeHead],
  ["indexed blocks", IndexedBlock],
  ["indexed blockchain events", IndexedBlockchainEvent],
  ["indexer checkpoints", IndexerCheckpoint],
  ["notifications", Notification],
  ["oracle health records", OracleHealth],
  ["oracle logs", OracleLog],
  ["revoked sessions", RevokedToken],
  ["users", User],
  ["voting finalizations", VotingFinalization],
];

const getChainReferenceDate = async () => {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  try {
    const latestBlock = await provider.getBlock("latest");
    if (!latestBlock) throw new Error("Latest local block is unavailable");
    return new Date(Number(latestBlock.timestamp) * 1000);
  } finally {
    provider.destroy();
  }
};

const resetLocalOracleCursors = () => {
  const stateDirectory = path.resolve(__dirname, "..", "..", "oracle", ".oracle-state");
  if (!fs.existsSync(stateDirectory)) return 0;

  const cursorFiles = fs
    .readdirSync(stateDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^cursor-\d+\.json$/.test(entry.name));
  for (const entry of cursorFiles) {
    fs.unlinkSync(path.join(stateDirectory, entry.name));
  }
  return cursorFiles.length;
};

async function main() {
  if (!process.argv.includes("--yes")) {
    throw new Error("Refusing to clear data without --yes.");
  }

  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing in backEnd/.env");
  }

  const hybridMode = process.argv.includes("--hybrid");
  let connectionError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      connectionError = null;
      break;
    } catch (error) {
      connectionError = error;
      if (attempt < 3) {
        console.warn(`MongoDB connection attempt ${attempt} failed; retrying...`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
  if (connectionError) throw connectionError;

  try {
    const databaseName = mongoose.connection.name || "configured database";
    console.log(`Clearing Block-Insure runtime data from MongoDB database: ${databaseName}`);

    for (const [label, Model] of collections) {
      const result = await Model.deleteMany({});
      console.log(`Removed ${result.deletedCount} ${label}.`);
    }

    const removedOracleCursors = resetLocalOracleCursors();
    console.log(`Removed ${removedOracleCursors} local oracle event cursors.`);

    const registryRecords = hybridMode
      ? await buildHybridRuntimeRecords({ demoReferenceDate: await getChainReferenceDate() })
      : buildSyntheticRecords();
    await MockHospitalRecord.deleteMany({});
    await MockHospitalRecordOracle2.deleteMany({});
    await MockHospitalRecord.insertMany(registryRecords);
    await MockHospitalRecordOracle2.insertMany(registryRecords);

    console.log(
      `Rebuilt ${registryRecords.length} ${hybridMode ? "hybrid" : "synthetic"} healthcare registry records for both oracle snapshots.`
    );
    console.log("MongoDB runtime data is clean. No policies, claims, appeals, or user activity are created by this script.");
  } finally {
    await mongoose.connection.close();
  }
}

main().catch((error) => {
  console.error("Local data reset failed:", error.message);
  process.exit(1);
});
