require("dotenv").config();

const dns = require("node:dns");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const mongoose = require("mongoose");
const MockHospitalRecord = require("../models/MockHospitalRecord");
const MockHospitalRecordOracle2 = require("../models/MockHospitalRecordOracle2");
const { buildSyntheticRecords } = require("./seedMockData");

dns.setDefaultResultOrder("ipv4first");

const RUNTIME_PATH = path.join(
  __dirname,
  "..",
  "datasets",
  "hybrid-v1",
  "runtime",
  "hybrid-primary.jsonl"
);

const readJsonLines = async (filePath) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Hybrid runtime dataset missing: ${filePath}. Run npm run build:hybrid first.`);
  }
  const records = [];
  const reader = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of reader) {
    if (line.trim()) records.push(JSON.parse(line));
  }
  return records;
};

const buildHybridRuntimeRecords = async () => {
  const preservedDemoPresets = buildSyntheticRecords().slice(0, 5).map((record) => ({
    ...record,
    baseDataOrigin: "FULLY_SYNTHETIC",
    claimSetting: "SYNTHETIC",
    providerLabelType: "NONE",
    scenarioInjected: false,
    scenarioType: "NONE",
    scenarioVersion: "legacy-demo-preset-v1",
  }));
  const hybridRecords = await readJsonLines(RUNTIME_PATH);
  return [...preservedDemoPresets, ...hybridRecords];
};

const seedHybridData = async () => {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is missing in .env");
  const records = await buildHybridRuntimeRecords();
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    await Promise.all([
      MockHospitalRecord.deleteMany({}),
      MockHospitalRecordOracle2.deleteMany({}),
    ]);
    await MockHospitalRecord.insertMany(records);
    await MockHospitalRecordOracle2.insertMany(records);
    console.log(`Seeded ${records.length} BlockInsure-Hybrid-v1 registry records.`);
    console.log("The first five legacy demo presets remain available to the existing claim UI.");
    console.log("Run npm run seed:mock to restore the original fully synthetic registry.");
  } finally {
    await mongoose.connection.close();
  }
};

if (require.main === module) {
  seedHybridData().catch(async (error) => {
    console.error("Hybrid registry seeding failed:", error.message);
    await mongoose.connection.close();
    process.exit(1);
  });
}

module.exports = { buildHybridRuntimeRecords, readJsonLines, seedHybridData };
