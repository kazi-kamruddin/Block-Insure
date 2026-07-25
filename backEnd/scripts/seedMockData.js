require("dotenv").config();

const dns = require("dns");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { ethers } = require("ethers");
const MockHospitalRecord = require("../models/MockHospitalRecord");
const MockHospitalRecordOracle2 = require("../models/MockHospitalRecordOracle2");

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

const addDays = (date, days) => {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
};

const treatmentProfiles = {
  HOSPITALIZATION: {
    diagnosisCodes: ["GEN-101", "GEN-118", "GEN-132"],
    min: 0.08,
    max: 0.35,
  },
  SURGERY: {
    diagnosisCodes: ["SUR-220", "SUR-244", "SUR-291"],
    min: 0.22,
    max: 0.9,
  },
  EMERGENCY: {
    diagnosisCodes: ["EMR-301", "EMR-330", "EMR-345"],
    min: 0.06,
    max: 0.28,
  },
  DIAGNOSTIC: {
    diagnosisCodes: ["DIA-410", "DIA-421", "DIA-440"],
    min: 0.03,
    max: 0.18,
  },
  MATERNITY: {
    diagnosisCodes: ["MAT-510", "MAT-522", "MAT-548"],
    min: 0.16,
    max: 0.55,
  },
};

const hospitals = [
  {
    hospitalId: "HOSP-001",
    hospitalName: "Dhaka Central Medical",
    division: "Dhaka",
    district: "Dhaka",
    hospitalTier: "TERTIARY",
    licenseStatus: "ACTIVE",
  },
  {
    hospitalId: "HOSP-002",
    hospitalName: "Chattogram Metro Hospital",
    division: "Chattogram",
    district: "Chattogram",
    hospitalTier: "TERTIARY",
    licenseStatus: "ACTIVE",
  },
  {
    hospitalId: "HOSP-003",
    hospitalName: "Sylhet Care Clinic",
    division: "Sylhet",
    district: "Sylhet",
    hospitalTier: "SECONDARY",
    licenseStatus: "ACTIVE",
  },
  {
    hospitalId: "HOSP-004",
    hospitalName: "Rajshahi Specialist Center",
    division: "Rajshahi",
    district: "Rajshahi",
    hospitalTier: "SPECIALIZED",
    licenseStatus: "ACTIVE",
  },
  {
    hospitalId: "HOSP-005",
    hospitalName: "Khulna General Hospital",
    division: "Khulna",
    district: "Khulna",
    hospitalTier: "SECONDARY",
    licenseStatus: "ACTIVE",
  },
  {
    hospitalId: "HOSP-006",
    hospitalName: "Barishal City Clinic",
    division: "Barishal",
    district: "Barishal",
    hospitalTier: "PRIMARY",
    licenseStatus: "SUSPENDED",
  },
  {
    hospitalId: "HOSP-007",
    hospitalName: "Rangpur North Medical",
    division: "Rangpur",
    district: "Rangpur",
    hospitalTier: "SECONDARY",
    licenseStatus: "ACTIVE",
  },
  {
    hospitalId: "HOSP-008",
    hospitalName: "Mymensingh Health Point",
    division: "Mymensingh",
    district: "Mymensingh",
    hospitalTier: "PRIMARY",
    licenseStatus: "BLACKLISTED",
  },
];

const generatedFraudScenarioCycle = [
  "LEGITIMATE",
  "INFLATED_AMOUNT",
  "USED_INVOICE",
  "LEGITIMATE",
  "CANCELLED_RECORD",
  "LEGITIMATE",
  "SUSPICIOUS_PATTERN",
  "LEGITIMATE",
  "USED_INVOICE",
  "INFLATED_AMOUNT",
  "LEGITIMATE",
  "CANCELLED_RECORD",
  "LEGITIMATE",
  "DATE_MISMATCH",
  "LEGITIMATE",
  "USED_INVOICE",
  "INFLATED_AMOUNT",
  "LEGITIMATE",
  "CANCELLED_RECORD",
  "LEGITIMATE",
  "SUSPICIOUS_PATTERN",
  "USED_INVOICE",
  "LEGITIMATE",
  "CANCELLED_RECORD",
];

const getFraudScenario = (index, hospital) => {
  if (hospital.licenseStatus === "BLACKLISTED") {
    return "BLACKLISTED_HOSPITAL";
  }

  return generatedFraudScenarioCycle[(index - 6) % generatedFraudScenarioCycle.length];
};

const deriveStatuses = (fraudLabel) => {
  if (fraudLabel === "USED_INVOICE") {
    return {
      recordStatus: "USED",
      invoiceStatus: "USED",
    };
  }

  if (fraudLabel === "CANCELLED_RECORD") {
    return {
      recordStatus: "CANCELLED",
      invoiceStatus: "CANCELLED",
    };
  }

  if (
    fraudLabel === "BLACKLISTED_HOSPITAL" ||
    fraudLabel === "DATE_MISMATCH" ||
    fraudLabel === "SUSPICIOUS_PATTERN"
  ) {
    return {
      recordStatus: "INVALID",
      invoiceStatus: "SUSPICIOUS",
    };
  }

  return {
    recordStatus: "VALID",
    invoiceStatus: "VALID",
  };
};

const getBillAmount = ({ profile, index, fraudLabel, fixedAmount }) => {
  if (fixedAmount) {
    return fixedAmount;
  }

  if (fraudLabel === "INFLATED_AMOUNT") {
    return (profile.max * 1.85).toFixed(2);
  }

  const range = profile.max - profile.min;
  const normalizedStep = ((index * 37) % 100) / 100;

  return (profile.min + range * normalizedStep).toFixed(2);
};

const buildRecord = ({
  index,
  hospital,
  treatmentType,
  invoiceNumber,
  patientName,
  baseDate,
  fixedAmount,
  forcedFraudLabel,
}) => {
  const profile = treatmentProfiles[treatmentType];
  const fraudLabel = forcedFraudLabel || getFraudScenario(index, hospital);
  const statuses = deriveStatuses(fraudLabel);
  const admissionDate =
    fraudLabel === "DATE_MISMATCH" ? addDays(baseDate, -45) : baseDate;
  const dischargeDate = addDays(admissionDate, 2 + (index % 4));
  const invoiceDate = addDays(dischargeDate, 1);
  const billAmount = getBillAmount({
    profile,
    index,
    fraudLabel,
    fixedAmount,
  });

  return {
    hospitalId: hospital.hospitalId,
    hospitalName: hospital.hospitalName,
    division: hospital.division,
    district: hospital.district,
    hospitalTier: hospital.hospitalTier,
    licenseStatus: hospital.licenseStatus,
    patientHash: sha256(`${patientName}-${hospital.hospitalId}`),
    patientAgeBand: index % 5 === 0 ? "SENIOR" : index % 4 === 0 ? "CHILD" : "ADULT",
    treatmentType,
    diagnosisCode: profile.diagnosisCodes[index % profile.diagnosisCodes.length],
    admissionDate,
    dischargeDate,
    invoiceDate,
    billAmount,
    expectedBillMin: profile.min.toString(),
    expectedBillMax: profile.max.toString(),
    invoiceNumber,
    invoiceHash: bytes32Hash(invoiceNumber),
    invoiceStatus: statuses.invoiceStatus,
    recordStatus: statuses.recordStatus,
    fraudLabel,
    fraudSignals: {
      usedInvoice: fraudLabel === "USED_INVOICE",
      cancelledRecord: fraudLabel === "CANCELLED_RECORD",
      inflatedAmount: fraudLabel === "INFLATED_AMOUNT",
      blacklistedHospital: fraudLabel === "BLACKLISTED_HOSPITAL",
      dateMismatch: fraudLabel === "DATE_MISMATCH",
    },
    previousClaimCount:
      fraudLabel === "USED_INVOICE" || fraudLabel === "SUSPICIOUS_PATTERN" ? 2 : 0,
    syntheticSource: "phase-1-seed-v2",
  };
};

const buildSyntheticRecords = () => {
  const records = [];
  const baseDate = new Date("2026-05-26T06:45:57.000Z");
  const presetRecords = [
    ["HOSP-001", "HOSPITALIZATION", "INV-HOSP-001-001", "Patient One", "0.1"],
    ["HOSP-002", "SURGERY", "INV-HOSP-002-001", "Patient Two", "0.2"],
    ["HOSP-003", "HOSPITALIZATION", "INV-HOSP-003-001", "Patient Three", "0.15"],
    ["HOSP-004", "SURGERY", "INV-HOSP-004-001", "Patient Four", "0.3"],
    ["HOSP-005", "EMERGENCY", "INV-HOSP-005-001", "Patient Five", "0.25"],
  ];

  presetRecords.forEach(
    ([hospitalId, treatmentType, invoiceNumber, patientName, fixedAmount], index) => {
      records.push(
        buildRecord({
          index: index + 1,
          hospital: hospitals.find((hospital) => hospital.hospitalId === hospitalId),
          treatmentType,
          invoiceNumber,
          patientName,
          baseDate: addDays(baseDate, index),
          fixedAmount,
          forcedFraudLabel: "LEGITIMATE",
        })
      );
    }
  );

  const treatmentTypes = Object.keys(treatmentProfiles);

  for (let index = 6; index <= 120; index += 1) {
    const hospital = hospitals[(index - 1) % hospitals.length];
    const treatmentType = treatmentTypes[index % treatmentTypes.length];
    const invoiceNumber = `INV-${hospital.hospitalId}-${String(index).padStart(3, "0")}`;

    records.push(
      buildRecord({
        index,
        hospital,
        treatmentType,
        invoiceNumber,
        patientName: `Synthetic Patient ${index}`,
        baseDate: addDays(baseDate, index),
      })
    );
  }

  return records;
};

const buildOracle2Records = (mockRecords) => {
  return mockRecords.map((record, index) => {
    if (index !== 0) {
      return record;
    }

    return {
      ...record,
      invoiceStatus: "USED",
      recordStatus: "USED",
      fraudLabel: "USED_INVOICE",
      fraudSignals: {
        ...record.fraudSignals,
        usedInvoice: true,
      },
      previousClaimCount: 2,
      syntheticSource: "phase-2-oracle2-independent-snapshot-v1",
    };
  });
};

const seedMockData = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is missing in .env");
    }

    const mockRecords = buildSyntheticRecords();

    await mongoose.connect(process.env.MONGODB_URI);

    await MockHospitalRecord.deleteMany({});
    await MockHospitalRecordOracle2.deleteMany({});

    await MockHospitalRecord.insertMany(mockRecords);
    const oracle2Records = buildOracle2Records(mockRecords);

    await MockHospitalRecordOracle2.insertMany(oracle2Records);

    const legitimateCount = mockRecords.filter(
      (record) => record.fraudLabel === "LEGITIMATE"
    ).length;
    const fraudulentCount = mockRecords.length - legitimateCount;

    console.log("Synthetic healthcare registry seeded successfully");
    console.log(`Inserted records: ${mockRecords.length}`);
    console.log(`Legitimate records: ${legitimateCount}`);
    console.log(`Fraud-labeled records: ${fraudulentCount}`);
    console.log("Oracle 2 snapshot divergence: INV-HOSP-001-001 is marked USED");

    console.log("\nUseful verified test invoices:");
    mockRecords
      .filter((record) => record.fraudLabel === "LEGITIMATE")
      .slice(0, 8)
      .forEach((record) => {
        console.log(
          `${record.hospitalId} | ${record.treatmentType} | ${record.billAmount} ETH | ${record.invoiceNumber} | ${record.invoiceHash}`
        );
      });

    console.log("\nUseful fraud-labeled test invoices:");
    mockRecords
      .filter((record) => record.fraudLabel !== "LEGITIMATE")
      .slice(0, 8)
      .forEach((record) => {
        console.log(
          `${record.hospitalId} | ${record.fraudLabel} | ${record.invoiceNumber} | ${record.invoiceHash}`
        );
      });

    await mongoose.connection.close();
  } catch (error) {
    console.error("Synthetic registry seeding failed:", error.message);
    process.exit(1);
  }
};

if (require.main === module) {
  seedMockData();
}

module.exports = {
  buildOracle2Records,
  buildSyntheticRecords,
};
