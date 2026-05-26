require("dotenv").config();

const dns = require("dns");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { ethers } = require("ethers");
const MockHospitalRecord = require("../models/MockHospitalRecord");

dns.setDefaultResultOrder("ipv4first");

if (process.env.FORCE_PUBLIC_DNS === "true") {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
}

const sha256 = (value) => {
  return crypto.createHash("sha256").update(value).digest("hex");
};

const bytes32Hash = (value) => {
  return ethers.keccak256(ethers.toUtf8Bytes(value));
};

const mockRecords = [
  {
    hospitalId: "HOSP-001",
    patientHash: sha256("Patient One"),
    admissionDate: new Date("2026-05-26T06:45:57.000Z"),
    billAmount: "0.1",
    invoiceHash: bytes32Hash("INV-HOSP-001-001"),
    recordStatus: "VALID",
  },
  {
    hospitalId: "HOSP-002",
    patientHash: sha256("Patient Two"),
    admissionDate: new Date("2026-05-27T09:30:00.000Z"),
    billAmount: "0.2",
    invoiceHash: bytes32Hash("INV-HOSP-002-001"),
    recordStatus: "VALID",
  },
  {
    hospitalId: "HOSP-003",
    patientHash: sha256("Patient Three"),
    admissionDate: new Date("2026-05-28T10:15:00.000Z"),
    billAmount: "0.15",
    invoiceHash: bytes32Hash("INV-HOSP-003-001"),
    recordStatus: "VALID",
  },
  {
    hospitalId: "HOSP-004",
    patientHash: sha256("Patient Four"),
    admissionDate: new Date("2026-05-29T11:00:00.000Z"),
    billAmount: "0.3",
    invoiceHash: bytes32Hash("INV-HOSP-004-001"),
    recordStatus: "VALID",
  },
  {
    hospitalId: "HOSP-005",
    patientHash: sha256("Patient Five"),
    admissionDate: new Date("2026-05-30T12:20:00.000Z"),
    billAmount: "0.25",
    invoiceHash: bytes32Hash("INV-HOSP-005-001"),
    recordStatus: "VALID",
  },
  {
    hospitalId: "HOSP-006",
    patientHash: sha256("Invalid Patient One"),
    admissionDate: new Date("2026-06-01T08:00:00.000Z"),
    billAmount: "0.5",
    invoiceHash: bytes32Hash("INV-HOSP-006-INVALID"),
    recordStatus: "INVALID",
  },
  {
    hospitalId: "HOSP-007",
    patientHash: sha256("Cancelled Patient"),
    admissionDate: new Date("2026-06-02T08:00:00.000Z"),
    billAmount: "0.4",
    invoiceHash: bytes32Hash("INV-HOSP-007-CANCELLED"),
    recordStatus: "CANCELLED",
  },
];

const seedMockData = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is missing in .env");
    }

    await mongoose.connect(process.env.MONGODB_URI);

    await MockHospitalRecord.deleteMany({});

    await MockHospitalRecord.insertMany(mockRecords);

    console.log("Mock hospital records seeded successfully");
    console.log(`Inserted records: ${mockRecords.length}`);

    console.log("\nUseful test invoice hashes:");
    mockRecords.forEach((record) => {
      console.log(`${record.hospitalId} | ${record.recordStatus} | ${record.invoiceHash}`);
    });

    await mongoose.connection.close();
  } catch (error) {
    console.error("Mock data seeding failed:", error.message);
    process.exit(1);
  }
};

seedMockData();