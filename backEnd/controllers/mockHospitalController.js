const MockHospitalRecord = require("../models/MockHospitalRecord");

const getAllHospitalRecords = async (req, res, next) => {
  try {
    const records = await MockHospitalRecord.find({}).sort({
      hospitalId: 1,
    });

    res.status(200).json({
      success: true,
      count: records.length,
      records,
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

    if (!record) {
      return res.status(200).json({
        success: true,
        verified: false,
        riskLevel: "HIGH",
        message: "No matching hospital record found",
        query: {
          hospitalId,
          invoiceHash: normalizedInvoiceHash,
        },
      });
    }

    if (record.recordStatus !== "VALID") {
      return res.status(200).json({
        success: true,
        verified: false,
        riskLevel: "HIGH",
        message: `Hospital record is ${record.recordStatus}`,
        record,
      });
    }

    res.status(200).json({
      success: true,
      verified: true,
      riskLevel: "LOW",
      message: "Hospital record matched",
      record,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllHospitalRecords,
  verifyHospitalRecord,
};