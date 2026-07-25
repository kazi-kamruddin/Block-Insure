require("dotenv").config();

const dns = require("dns");
const mongoose = require("mongoose");
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
const {
  buildOracle2Records,
  buildSyntheticRecords,
} = require("./seedMockData");

dns.setDefaultResultOrder("ipv4first");

if (process.env.FORCE_PUBLIC_DNS === "true") {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
}

const collections = [
  ["admin action logs", AdminActionLog],
  ["appeals", Appeal],
  ["claim submission attempts", ClaimSubmissionAttempt],
  ["documents", File],
  ["notifications", Notification],
  ["oracle health records", OracleHealth],
  ["oracle logs", OracleLog],
  ["revoked sessions", RevokedToken],
  ["users", User],
  ["voting finalizations", VotingFinalization],
];

async function main() {
  if (!process.argv.includes("--yes")) {
    throw new Error("Refusing to clear data without --yes.");
  }

  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing in backend/.env");
  }

  await mongoose.connect(process.env.MONGODB_URI);

  try {
    const databaseName = mongoose.connection.name || "configured database";
    console.log(`Clearing Block-Insure runtime data from MongoDB database: ${databaseName}`);

    for (const [label, Model] of collections) {
      const result = await Model.deleteMany({});
      console.log(`Removed ${result.deletedCount} ${label}.`);
    }

    const registryRecords = buildSyntheticRecords();
    await MockHospitalRecord.deleteMany({});
    await MockHospitalRecordOracle2.deleteMany({});
    await MockHospitalRecord.insertMany(registryRecords);
    await MockHospitalRecordOracle2.insertMany(
      buildOracle2Records(registryRecords)
    );

    console.log(`Rebuilt ${registryRecords.length} synthetic healthcare registry records for both oracle snapshots.`);
    console.log("MongoDB runtime data is clean. No policies, claims, appeals, or user activity are created by this script.");
  } finally {
    await mongoose.connection.close();
  }
}

main().catch((error) => {
  console.error("Local data reset failed:", error.message);
  process.exit(1);
});
