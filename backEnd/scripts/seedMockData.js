require("dotenv").config();

const dns = require("node:dns");
const mongoose = require("mongoose");
const { ethers } = require("ethers");
const MockHospitalRecord = require("../models/MockHospitalRecord");
const MockHospitalRecordOracle2 = require("../models/MockHospitalRecordOracle2");
const { generateSyntheticDataset } = require("../services/syntheticRegistryService");

dns.setDefaultResultOrder("ipv4first");

const DEMO_PRESETS = [
  ["HOSP-001", "HOSPITALIZATION", "INV-HOSP-001-001", "0.1"],
  ["HOSP-002", "SURGERY", "INV-HOSP-002-001", "0.2"],
  ["HOSP-003", "HOSPITALIZATION", "INV-HOSP-003-001", "0.15"],
  ["HOSP-004", "SURGERY", "INV-HOSP-004-001", "0.3"],
  ["HOSP-005", "EMERGENCY", "INV-HOSP-005-001", "0.25"],
];

const buildSyntheticRecords = () => {
  const records = generateSyntheticDataset({ profile: "normal", seed: 202605, size: 600 });
  DEMO_PRESETS.forEach(([hospitalId, treatmentType, invoiceNumber, billAmount], index) => {
    records[index] = {
      ...records[index],
      recordId: `demo-preset-${index + 1}`,
      hospitalId,
      providerId: hospitalId,
      hospitalName: `Demo Provider ${index + 1}`,
      treatmentType,
      invoiceNumber,
      invoiceHash: ethers.keccak256(ethers.toUtf8Bytes(invoiceNumber)),
      billAmount,
      expectedBillMin: "0.01",
      expectedBillMax: "1.0",
      licenseStatus: "ACTIVE",
      invoiceStatus: "VALID",
      recordStatus: "VALID",
      fraudLabel: "LEGITIMATE",
      actualFraud: false,
      fraudSignals: {
        usedInvoice: false,
        cancelledRecord: false,
        inflatedAmount: false,
        blacklistedHospital: false,
        dateMismatch: false,
      },
      previousClaimCount: 0,
      providerVelocityAnomaly: false,
      claimantVelocityAnomaly: false,
      nearDuplicateAdvisory: false,
      isMissingOrNoisy: false,
      dataQuality: "COMPLETE",
      recurringLegitimate: false,
      syntheticSource: "phase-5-demo-preset-v1",
    };
  });
  return records;
};

const buildOracle2Records = (records) => records.map((record, index) => index === 0
  ? {
      ...record,
      invoiceStatus: "USED",
      recordStatus: "USED",
      fraudLabel: "USED_INVOICE",
      actualFraud: true,
      fraudSignals: { ...record.fraudSignals, usedInvoice: true },
      previousClaimCount: 2,
      syntheticSource: "phase-5-oracle2-independent-snapshot-v1",
    }
  : record);

const seedMockData = async () => {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is missing in .env");
  const records = buildSyntheticRecords();
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    await Promise.all([
      MockHospitalRecord.deleteMany({}),
      MockHospitalRecordOracle2.deleteMany({}),
    ]);
    await MockHospitalRecord.insertMany(records);
    await MockHospitalRecordOracle2.insertMany(buildOracle2Records(records));
    const fraudCount = records.filter((record) => record.actualFraud).length;
    console.log(`Seeded ${records.length} Phase 5 registry records (${fraudCount} latent fraud labels).`);
    console.log("Generated claimant/provider groups, recurring care, fraud clusters, noise, drift, and duplicate variants.");
  } finally {
    await mongoose.connection.close();
  }
};

if (require.main === module) {
  seedMockData().catch(async (error) => {
    console.error("Synthetic registry seeding failed:", error.message);
    await mongoose.connection.close();
    process.exit(1);
  });
}

module.exports = { buildOracle2Records, buildSyntheticRecords };
