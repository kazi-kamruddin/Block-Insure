const { ethers } = require("ethers");
const MockHospitalRecord = require("../models/MockHospitalRecord");
const { buildRiskAssessment } = require("../services/riskScoringService");

const DATE_TOLERANCE_DAYS = 30;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const BILL_RANGE_TOLERANCE_RATE = 0.15;

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

const getHigherRiskLevel = (...levels) => {
  const rank = {
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3,
    FRAUD_FLAGGED: 3,
    ORACLE_FAILED: 3,
  };

  return levels.reduce((highest, level) => {
    return (rank[level] || 0) > (rank[highest] || 0) ? level : highest;
  }, "LOW");
};

const normalizeText = (value) => String(value || "").trim().toUpperCase();

const normalizeHash = (value) => String(value || "").trim().toLowerCase();

const formatDate = (value) => {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
};

const parseEthAmount = ({ claimAmountEth, claimAmountWei }) => {
  if (claimAmountEth !== undefined && claimAmountEth !== null && claimAmountEth !== "") {
    const amount = Number(claimAmountEth);
    return Number.isFinite(amount) ? amount : null;
  }

  if (claimAmountWei !== undefined && claimAmountWei !== null && claimAmountWei !== "") {
    try {
      const amount = Number(ethers.formatEther(claimAmountWei));
      return Number.isFinite(amount) ? amount : null;
    } catch {
      return null;
    }
  }

  return null;
};

const parseIncidentDate = (value) => {
  if (!value) return null;

  const rawValue = typeof value === "object" && value.unix ? value.unix : value;
  const numericValue = Number(rawValue);

  if (Number.isFinite(numericValue) && numericValue > 0) {
    const timestampMs =
      numericValue > 100000000000 ? numericValue : numericValue * 1000;
    const date = new Date(timestampMs);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(rawValue);
  return Number.isNaN(date.getTime()) ? null : date;
};

const buildCheck = ({
  label,
  expected,
  actual,
  matched,
  severity = "HIGH",
  blocking = true,
  note = "",
}) => ({
  label,
  expected,
  actual,
  matched,
  severity,
  blocking,
  note,
});

const summarizeChecks = (fieldChecks, decisionFactors = {}) => {
  const entries = Object.entries(fieldChecks);
  const checks = entries.map(([, check]) => check);
  const passedChecks = checks.filter((check) => check.matched).length;
  const blockingFailures = entries
    .filter(([, check]) => check.blocking && !check.matched)
    .map(([field, check]) => ({
      field,
      label: check.label,
      expected: check.expected,
      actual: check.actual,
      severity: check.severity,
      note: check.note,
    }));
  const warningFailures = entries
    .filter(([, check]) => !check.blocking && !check.matched)
    .map(([field, check]) => ({
      field,
      label: check.label,
      expected: check.expected,
      actual: check.actual,
      severity: check.severity,
      note: check.note,
    }));

  return {
    fieldChecks,
    passedChecks,
    totalChecks: checks.length,
    blockingFailureCount: blockingFailures.length,
    warningFailureCount: warningFailures.length,
    blockingFailures,
    warningFailures,
    matchScore: checks.length
      ? Math.round((passedChecks / checks.length) * 100)
      : 0,
    decisionFactors,
  };
};

const buildVerificationComparison = ({
  record,
  hospitalId,
  invoiceHash,
  claimAmountEth,
  claimAmountWei,
  claimType,
  incidentDate,
}) => {
  const normalizedHospitalId = normalizeText(hospitalId);
  const normalizedInvoiceHash = normalizeHash(invoiceHash);
  const claimAmount = parseEthAmount({ claimAmountEth, claimAmountWei });
  const parsedIncidentDate = parseIncidentDate(incidentDate);

  if (!record) {
    return summarizeChecks(
      {
        registryRecord: buildCheck({
          label: "Registry record",
          expected: "Existing invoice hash in synthetic registry",
          actual: "Not found",
          matched: false,
          note: "The invoice hash did not resolve to any synthetic registry record.",
        }),
        hospitalId: buildCheck({
          label: "Hospital ID",
          expected: hospitalId,
          actual: null,
          matched: false,
        }),
        invoiceHash: buildCheck({
          label: "Invoice hash",
          expected: normalizedInvoiceHash,
          actual: null,
          matched: false,
        }),
      },
      {
        claimAmountEth: claimAmount,
        claimType: claimType || null,
        incidentDate: formatDate(parsedIncidentDate),
      }
    );
  }

  const registryBillAmount = Number(record.billAmount);
  const expectedBillMin = Number(record.expectedBillMin);
  const expectedBillMax = Number(record.expectedBillMax);
  const admissionDate = record.admissionDate ? new Date(record.admissionDate) : null;
  const dischargeDate = record.dischargeDate ? new Date(record.dischargeDate) : null;
  const invoiceDate = record.invoiceDate ? new Date(record.invoiceDate) : null;
  const earliestAllowedDate = admissionDate
    ? new Date(admissionDate.getTime() - DATE_TOLERANCE_DAYS * DAY_IN_MS)
    : null;
  const latestSourceDate = invoiceDate || dischargeDate || admissionDate;
  const latestAllowedDate = latestSourceDate
    ? new Date(latestSourceDate.getTime() + DATE_TOLERANCE_DAYS * DAY_IN_MS)
    : null;
  const hasDateWindow =
    parsedIncidentDate && earliestAllowedDate && latestAllowedDate;
  const dateMatched = hasDateWindow
    ? parsedIncidentDate >= earliestAllowedDate &&
      parsedIncidentDate <= latestAllowedDate
    : true;
  const amountSupplied = claimAmount !== null;
  const registryAmountSupplied = Number.isFinite(registryBillAmount);
  const expectedRangeSupplied =
    Number.isFinite(expectedBillMin) && Number.isFinite(expectedBillMax);
  const toleratedBillMin = expectedRangeSupplied
    ? expectedBillMin * (1 - BILL_RANGE_TOLERANCE_RATE)
    : null;
  const toleratedBillMax = expectedRangeSupplied
    ? expectedBillMax * (1 + BILL_RANGE_TOLERANCE_RATE)
    : null;

  const fieldChecks = {
    hospitalId: buildCheck({
      label: "Hospital ID",
      expected: hospitalId,
      actual: record.hospitalId,
      matched: normalizeText(record.hospitalId) === normalizedHospitalId,
    }),
    invoiceHash: buildCheck({
      label: "Invoice hash",
      expected: normalizedInvoiceHash,
      actual: record.invoiceHash,
      matched: normalizeHash(record.invoiceHash) === normalizedInvoiceHash,
    }),
    billAmount: buildCheck({
      label: "Bill amount",
      expected: registryAmountSupplied
        ? `Claim amount <= ${record.billAmount} ETH`
        : "Registry bill amount available",
      actual: amountSupplied ? `${claimAmount} ETH` : "Not supplied",
      matched:
        amountSupplied &&
        registryAmountSupplied &&
        claimAmount <= registryBillAmount,
      note: "Compares the on-chain claim amount with the synthetic invoice bill.",
    }),
    expectedBillRange: buildCheck({
      label: "Treatment bill range",
      expected: expectedRangeSupplied
        ? `${record.expectedBillMin} ETH - ${record.expectedBillMax} ETH (+/- ${Math.round(BILL_RANGE_TOLERANCE_RATE * 100)}%)`
        : "Expected bill range available",
      actual: registryAmountSupplied ? `${record.billAmount} ETH` : "Not supplied",
      matched:
        registryAmountSupplied &&
        expectedRangeSupplied &&
        registryBillAmount >= toleratedBillMin &&
        registryBillAmount <= toleratedBillMax,
      note: "Checks whether the registry invoice amount is plausible for the treatment profile.",
    }),
    treatmentType: buildCheck({
      label: "Treatment type",
      expected: record.treatmentType,
      actual: claimType || "Not supplied",
      matched: normalizeText(record.treatmentType) === normalizeText(claimType),
    }),
    dateConsistency: buildCheck({
      label: "Date consistency",
      expected:
        admissionDate && latestSourceDate
          ? `${formatDate(admissionDate)} to ${formatDate(latestSourceDate)} (+/- ${DATE_TOLERANCE_DAYS} days)`
          : "Registry treatment window available",
      actual: parsedIncidentDate ? formatDate(parsedIncidentDate) : "Not supplied",
      matched: dateMatched,
      severity: "WARN",
      blocking: false,
      note: "Non-blocking tolerance check between claim incident date and registry treatment dates.",
    }),
    recordStatus: buildCheck({
      label: "Registry record status",
      expected: "VALID",
      actual: record.recordStatus,
      matched: record.recordStatus === "VALID",
    }),
    invoiceStatus: buildCheck({
      label: "Invoice status",
      expected: "VALID",
      actual: record.invoiceStatus,
      matched: record.invoiceStatus === "VALID",
    }),
    licenseStatus: buildCheck({
      label: "Hospital license",
      expected: "ACTIVE",
      actual: record.licenseStatus,
      matched: record.licenseStatus === "ACTIVE",
    }),
    fraudLabel: buildCheck({
      label: "Fraud label",
      expected: "LEGITIMATE",
      actual: record.fraudLabel,
      matched: record.fraudLabel === "LEGITIMATE",
    }),
  };

  return summarizeChecks(fieldChecks, {
    claimAmountEth: claimAmount,
    registryBillAmountEth: registryAmountSupplied ? registryBillAmount : null,
    expectedBillMinEth: expectedRangeSupplied ? expectedBillMin : null,
    expectedBillMaxEth: expectedRangeSupplied ? expectedBillMax : null,
    claimType: claimType || null,
    registryTreatmentType: record.treatmentType,
    incidentDate: formatDate(parsedIncidentDate),
    admissionDate: formatDate(admissionDate),
    dischargeDate: formatDate(dischargeDate),
    invoiceDate: formatDate(invoiceDate),
    dateToleranceDays: DATE_TOLERANCE_DAYS,
  });
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
    const {
      hospitalId,
      invoiceHash,
      claimAmountEth,
      claimAmountWei,
      claimType,
      incidentDate,
    } = req.query;

    if (!hospitalId || !invoiceHash) {
      return res.status(400).json({
        success: false,
        verified: false,
        message: "hospitalId and invoiceHash are required",
      });
    }

    const normalizedInvoiceHash = normalizeHash(invoiceHash);

    const record = await MockHospitalRecord.findOne({
      invoiceHash: normalizedInvoiceHash,
    });

    const comparison = buildVerificationComparison({
      record,
      hospitalId,
      invoiceHash: normalizedInvoiceHash,
      claimAmountEth,
      claimAmountWei,
      claimType,
      incidentDate,
    });
    const verificationQuery = {
      hospitalId,
      invoiceHash: normalizedInvoiceHash,
      claimAmountEth: claimAmountEth || null,
      claimAmountWei: claimAmountWei || null,
      claimType: claimType || null,
      incidentDate: incidentDate || null,
    };
    const riskAssessment = await buildRiskAssessment({
      record,
      comparison,
      query: verificationQuery,
    });

    if (!record) {
      return res.status(200).json({
        success: true,
        verified: false,
        riskLevel: getHigherRiskLevel("HIGH", riskAssessment.riskLevel),
        message: "No matching synthetic healthcare registry record found",
        comparison,
        riskAssessment,
        query: verificationQuery,
      });
    }

    const comparisonVerified = comparison.blockingFailureCount === 0;
    const verified =
      comparisonVerified &&
      riskAssessment.recommendation !== "REJECT_ORACLE_VERIFICATION";

    const comparisonRiskLevel = comparisonVerified
      ? comparison.warningFailureCount > 0
        ? "MEDIUM"
        : "LOW"
      : comparison.blockingFailures.some((failure) => failure.severity === "HIGH")
        ? "HIGH"
        : "MEDIUM";
    const riskLevel = getHigherRiskLevel(
      comparisonRiskLevel,
      riskAssessment.riskLevel
    );
    const failureSummary = comparison.blockingFailures
      .map((failure) => failure.label)
      .join(", ");

    res.status(200).json({
      success: true,
      verified,
      riskLevel,
      message: verified
        ? comparison.warningFailureCount > 0
          ? "Synthetic healthcare registry record matched with non-blocking warnings"
          : "Synthetic healthcare registry record matched"
        : comparisonVerified
          ? "Bayesian risk engine rejected the claim for high fraud probability"
          : `Registry verification failed: ${failureSummary || record.fraudLabel}`,
      comparison,
      riskAssessment,
      query: verificationQuery,
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
