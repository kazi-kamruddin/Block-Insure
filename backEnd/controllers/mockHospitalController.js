const MockHospitalRecord = require("../models/MockHospitalRecord");

const toBoolean = (value) => {
  if (value === undefined || value === null) return undefined;
  return String(value).toLowerCase() === "true";
};

const buildRegistryFilter = (query) => {
  const filter = {};

  const exactFilters = [
    "hospitalId",
    "division",
    "district",
    "treatmentType",
    "recordStatus",
    "invoiceStatus",
    "fraudLabel",
    "licenseStatus",
  ];

  exactFilters.forEach((field) => {
    if (query[field]) {
      filter[field] = query[field];
    }
  });

  const hasFraud = toBoolean(query.hasFraud);

  if (hasFraud !== undefined) {
    filter.fraudLabel = hasFraud ? { $ne: "LEGITIMATE" } : "LEGITIMATE";
  }

  if (query.q) {
    const expression = new RegExp(query.q, "i");

    filter.$or = [
      { hospitalId: expression },
      { hospitalName: expression },
      { invoiceNumber: expression },
      { treatmentType: expression },
      { district: expression },
      { division: expression },
    ];
  }

  return filter;
};

const getRegistrySummary = async (filter = {}) => {
  const [
    total,
    legitimate,
    fraudulent,
    valid,
    invalid,
    used,
    cancelled,
    activeHospitals,
    suspendedHospitals,
    blacklistedHospitals,
    treatmentBreakdown,
    fraudBreakdown,
  ] = await Promise.all([
    MockHospitalRecord.countDocuments(filter),
    MockHospitalRecord.countDocuments({ ...filter, fraudLabel: "LEGITIMATE" }),
    MockHospitalRecord.countDocuments({
      ...filter,
      fraudLabel: { $ne: "LEGITIMATE" },
    }),
    MockHospitalRecord.countDocuments({ ...filter, recordStatus: "VALID" }),
    MockHospitalRecord.countDocuments({ ...filter, recordStatus: "INVALID" }),
    MockHospitalRecord.countDocuments({ ...filter, recordStatus: "USED" }),
    MockHospitalRecord.countDocuments({ ...filter, recordStatus: "CANCELLED" }),
    MockHospitalRecord.countDocuments({ ...filter, licenseStatus: "ACTIVE" }),
    MockHospitalRecord.countDocuments({ ...filter, licenseStatus: "SUSPENDED" }),
    MockHospitalRecord.countDocuments({ ...filter, licenseStatus: "BLACKLISTED" }),
    MockHospitalRecord.aggregate([
      { $match: filter },
      { $group: { _id: "$treatmentType", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ]),
    MockHospitalRecord.aggregate([
      { $match: filter },
      { $group: { _id: "$fraudLabel", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ]),
  ]);

  return {
    total,
    legitimate,
    fraudulent,
    statusCounts: {
      valid,
      invalid,
      used,
      cancelled,
    },
    licenseCounts: {
      active: activeHospitals,
      suspended: suspendedHospitals,
      blacklisted: blacklistedHospitals,
    },
    treatmentBreakdown: treatmentBreakdown.map((item) => ({
      treatmentType: item._id,
      count: item.count,
    })),
    fraudBreakdown: fraudBreakdown.map((item) => ({
      fraudLabel: item._id,
      count: item.count,
    })),
  };
};

const buildVerificationComparison = ({ record, hospitalId, invoiceHash }) => {
  if (!record) {
    return {
      fieldChecks: {
        hospitalId: {
          expected: hospitalId,
          actual: null,
          matched: false,
        },
        invoiceHash: {
          expected: invoiceHash,
          actual: null,
          matched: false,
        },
      },
      passedChecks: 0,
      totalChecks: 2,
      matchScore: 0,
    };
  }

  const fieldChecks = {
    hospitalId: {
      expected: hospitalId,
      actual: record.hospitalId,
      matched: record.hospitalId === hospitalId,
    },
    invoiceHash: {
      expected: invoiceHash,
      actual: record.invoiceHash,
      matched: record.invoiceHash === invoiceHash,
    },
    recordStatus: {
      expected: "VALID",
      actual: record.recordStatus,
      matched: record.recordStatus === "VALID",
    },
    invoiceStatus: {
      expected: "VALID",
      actual: record.invoiceStatus,
      matched: record.invoiceStatus === "VALID",
    },
    licenseStatus: {
      expected: "ACTIVE",
      actual: record.licenseStatus,
      matched: record.licenseStatus === "ACTIVE",
    },
    fraudLabel: {
      expected: "LEGITIMATE",
      actual: record.fraudLabel,
      matched: record.fraudLabel === "LEGITIMATE",
    },
  };

  const checks = Object.values(fieldChecks);
  const passedChecks = checks.filter((check) => check.matched).length;

  return {
    fieldChecks,
    passedChecks,
    totalChecks: checks.length,
    matchScore: Math.round((passedChecks / checks.length) * 100),
  };
};

const getAllHospitalRecords = async (req, res, next) => {
  try {
    const filter = buildRegistryFilter(req.query);
    const limit = Math.min(Number(req.query.limit || 100), 500);
    const page = Math.max(Number(req.query.page || 1), 1);
    const skip = (page - 1) * limit;

    const [records, summary] = await Promise.all([
      MockHospitalRecord.find(filter)
        .sort({ hospitalId: 1, invoiceDate: -1, invoiceNumber: 1 })
        .skip(skip)
        .limit(limit),
      getRegistrySummary(filter),
    ]);

    res.status(200).json({
      success: true,
      count: records.length,
      page,
      limit,
      summary,
      records,
    });
  } catch (error) {
    next(error);
  }
};

const getHospitalRecordById = async (req, res, next) => {
  try {
    const record = await MockHospitalRecord.findById(req.params.id);

    if (!record) {
      return res.status(404).json({
        success: false,
        message: "Synthetic healthcare registry record not found",
      });
    }

    res.status(200).json({
      success: true,
      record,
    });
  } catch (error) {
    next(error);
  }
};

const getHospitalRegistrySummary = async (req, res, next) => {
  try {
    const filter = buildRegistryFilter(req.query);
    const summary = await getRegistrySummary(filter);

    res.status(200).json({
      success: true,
      summary,
    });
  } catch (error) {
    next(error);
  }
};

const verifyHospitalRecord = async (req, res, next) => {
  try {
    const { hospitalId, invoiceHash } = req.query;

    if (!hospitalId || !invoiceHash) {
      return res.status(400).json({
        success: false,
        verified: false,
        message: "hospitalId and invoiceHash are required",
      });
    }

    const normalizedInvoiceHash = invoiceHash.toLowerCase();

    const record = await MockHospitalRecord.findOne({
      hospitalId,
      invoiceHash: normalizedInvoiceHash,
    });

    const comparison = buildVerificationComparison({
      record,
      hospitalId,
      invoiceHash: normalizedInvoiceHash,
    });

    if (!record) {
      return res.status(200).json({
        success: true,
        verified: false,
        riskLevel: "HIGH",
        message: "No matching synthetic healthcare registry record found",
        comparison,
        query: {
          hospitalId,
          invoiceHash: normalizedInvoiceHash,
        },
      });
    }

    const verified =
      record.recordStatus === "VALID" &&
      record.invoiceStatus === "VALID" &&
      record.licenseStatus === "ACTIVE" &&
      record.fraudLabel === "LEGITIMATE";

    const riskLevel = verified
      ? "LOW"
      : record.fraudLabel === "INFLATED_AMOUNT" ||
          record.licenseStatus === "SUSPENDED"
        ? "MEDIUM"
        : "HIGH";

    res.status(200).json({
      success: true,
      verified,
      riskLevel,
      message: verified
        ? "Synthetic healthcare registry record matched"
        : `Registry verification failed: ${record.fraudLabel}`,
      comparison,
      record,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllHospitalRecords,
  getHospitalRecordById,
  getHospitalRegistrySummary,
  verifyHospitalRecord,
};
