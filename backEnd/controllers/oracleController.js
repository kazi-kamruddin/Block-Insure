const OracleLog = require("../models/OracleLog");
const { getReadOnlyContract } = require("../services/contractService");

const canReadClaimOracleLogs = async (req, claimId) => {
  if (req.user.role === "ADMIN" || req.user.role === "AUDITOR") {
    return true;
  }

  const contract = getReadOnlyContract();
  const claim = await contract.getClaim(claimId);

  return claim.claimantWallet.toLowerCase() === req.user.walletAddress.toLowerCase();
};

const createOracleLog = async (req, res, next) => {
  try {
    const {
      requestId,
      claimId,
      oracleType = "HOSPITAL",
      queryData = {},
      responseData = {},
      resultHash,
      verified,
      riskLevel = "MEDIUM",
      submittedTxHash = "",
    } = req.body;

    if (!requestId || !claimId || !resultHash || verified === undefined) {
      return res.status(400).json({
        success: false,
        message: "requestId, claimId, resultHash, and verified are required",
      });
    }

    const oracleLog = await OracleLog.create({
      requestId: requestId.toString(),
      claimId: claimId.toString(),
      oracleType,
      queryData,
      responseData,
      resultHash,
      verified,
      riskLevel,
      submittedTxHash,
    });

    res.status(201).json({
      success: true,
      message: "Oracle log saved successfully",
      oracleLog,
    });
  } catch (error) {
    next(error);
  }
};

const getOracleLogsByClaim = async (req, res, next) => {
  try {
    const canRead = await canReadClaimOracleLogs(req, req.params.claimId);

    if (!canRead) {
      return res.status(403).json({
        success: false,
        message: "Access denied: claim does not belong to this wallet",
      });
    }

    const logs = await OracleLog.find({
      claimId: req.params.claimId.toString(),
    }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: logs.length,
      logs,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createOracleLog,
  getOracleLogsByClaim,
};
