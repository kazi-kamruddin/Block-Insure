const OracleLog = require("../models/OracleLog");
const OracleHealth = require("../models/OracleHealth");
const { getReadOnlyContract } = require("../services/contractService");
const { notifyClaimStatusChange } = require("../services/notificationService");

const CLAIM_STATUS = [
  "SUBMITTED",
  "DUPLICATE_CHECKED",
  "FRAUD_FLAGGED",
  "ORACLE_PENDING",
  "ORACLE_VERIFIED",
  "ORACLE_FAILED",
  "MANUAL_REVIEW",
  "APPROVED",
  "REJECTED",
  "SETTLED",
  "CLOSED",
];

const canReadClaimOracleLogs = async (req, claimId) => {
  if (req.user.role === "ADMIN" || req.user.role === "AUDITOR") {
    return true;
  }

  const contract = getReadOnlyContract();
  const claim = await contract.getClaim(claimId);

  return claim.claimantWallet.toLowerCase() === req.user.walletAddress.toLowerCase();
};

const formatTimestamp = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const extractMerkleProof = (log) => (
  log.responseData?.hospitalVerification?.merkleProof ||
  log.responseData?.merkleProof ||
  {}
);

const formatOracleLog = (log) => {
  const merkleProof = extractMerkleProof(log);
  const response = log.responseData || {};

  return {
    _id: log._id,
    requestId: log.requestId,
    claimId: log.claimId,
    oracleType: log.oracleType,
    oracleWallet: log.oracleWallet || response.oracleWallet || "",
    oracleInstanceId: log.oracleInstanceId || response.oracleInstanceId || "",
    verified: log.verified,
    result: log.verified ? "VERIFIED" : "FAILED",
    registryRootMatched:
      response.merkleRootMatchesChain ??
      (merkleProof.rootHash && response.registryCommitment?.onChainRoot
        ? String(merkleProof.rootHash).toLowerCase() ===
          String(response.registryCommitment.onChainRoot).toLowerCase()
        : null),
    riskLevel: log.riskLevel,
    remarks: log.remarks || response.remarks || response.message || "",
    resultHash: log.resultHash,
    submittedTxHash: log.submittedTxHash,
    txHash: log.submittedTxHash,
    responseTimeMs: log.responseTimeMs,
    createdAt: log.createdAt,
    timestamp: formatTimestamp(log.createdAt),
    responseData: log.responseData,
    queryData: log.queryData,
  };
};

const getOracleStatus = (lastHeartbeatAt) => {
  if (!lastHeartbeatAt) return "OFFLINE";

  const ageMs = Date.now() - new Date(lastHeartbeatAt).getTime();

  if (ageMs <= 2 * 60 * 1000) return "ONLINE";
  if (ageMs <= 10 * 60 * 1000) return "STALE";
  return "OFFLINE";
};

const formatOracleHealth = (health) => ({
  id: health._id,
  oracleWallet: health.oracleWallet,
  oracleInstanceId: health.oracleInstanceId,
  label: health.label || health.oracleInstanceId || health.oracleWallet || "Oracle",
  registrySnapshot: health.registrySnapshot,
  registryRoot: health.registryRoot,
  lastHeartbeatAt: health.lastHeartbeatAt,
  lastProcessedRequestId: health.lastProcessedRequestId,
  lastProcessedClaimId: health.lastProcessedClaimId,
  lastTxHash: health.lastTxHash,
  configIdentity: health.configIdentity,
  status: getOracleStatus(health.lastHeartbeatAt),
  updatedAt: health.updatedAt,
});

const upsertOracleHealth = async ({
  oracleWallet = "",
  oracleInstanceId = "",
  label = "",
  registrySnapshot = "",
  registryRoot = "",
  requestId = "",
  claimId = "",
  txHash = "",
  configIdentity = "",
}) => {
  const normalizedWallet = String(oracleWallet || "").trim().toLowerCase();
  const normalizedInstanceId = String(oracleInstanceId || "").trim();

  if (!normalizedWallet && !normalizedInstanceId) {
    return null;
  }

  return OracleHealth.findOneAndUpdate(
    {
      oracleWallet: normalizedWallet,
      oracleInstanceId: normalizedInstanceId,
    },
    {
      $set: {
        oracleWallet: normalizedWallet,
        oracleInstanceId: normalizedInstanceId,
        label,
        registrySnapshot,
        registryRoot,
        lastHeartbeatAt: new Date(),
        lastProcessedRequestId: requestId ? requestId.toString() : "",
        lastProcessedClaimId: claimId ? claimId.toString() : "",
        lastTxHash: txHash || "",
        configIdentity,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const buildQuorumSummary = async ({ contract, claimId, logs }) => {
  const verifiedCount = logs.filter((log) => log.verified === true).length;
  const failedCount = logs.filter((log) => log.verified === false).length;
  const requiredQuorum = Number(await contract.oracleQuorumThreshold());
  let oracleRequest = null;
  let statusLabel = "NO_REQUEST";
  let timedOut = false;

  try {
    oracleRequest = await contract.getOracleRequestByClaimId(claimId);
    const claim = await contract.getClaim(claimId);
    const currentBlock = await contract.runner.getBlockNumber();
    const timeoutBlocks = await contract.oracleTimeoutBlocks();
    const requestBlock = Number(oracleRequest.requestBlock);

    statusLabel = CLAIM_STATUS[Number(claim.status)] || "UNKNOWN";
    timedOut =
      !oracleRequest.isFulfilled &&
      currentBlock > requestBlock + Number(timeoutBlocks);
  } catch {
    // Claims may legitimately have no oracle request yet.
  }

  const finalOutcome = oracleRequest?.isFulfilled
    ? oracleRequest.verifiedResult
      ? "VERIFIED"
      : "FAILED"
    : timedOut
      ? "TIMED_OUT"
      : logs.length > 0
        ? "PENDING_QUORUM"
        : "PENDING";

  return {
    requestId: oracleRequest?.requestId?.toString?.() || null,
    confirmationsReceived: logs.length,
    requiredQuorum,
    verifiedCount,
    failedCount,
    pendingCount: Math.max(requiredQuorum - logs.length, 0),
    timedOut,
    isFulfilled: Boolean(oracleRequest?.isFulfilled),
    finalOutcome,
    claimStatus: statusLabel,
    requestBlock: oracleRequest?.requestBlock?.toString?.() || null,
    requestedAt: oracleRequest?.requestedAt?.toString?.() || null,
  };
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
      responseTimeMs = null,
      oracleWallet = "",
      oracleInstanceId = "",
      remarks = "",
    } = req.body;

    if (!requestId || !claimId || !resultHash || verified === undefined) {
      return res.status(400).json({
        success: false,
        message: "requestId, claimId, resultHash, and verified are required",
      });
    }

    const normalizedResponseTimeMs =
      responseTimeMs === null || responseTimeMs === undefined || responseTimeMs === ""
        ? null
        : Number(responseTimeMs);

    if (
      normalizedResponseTimeMs !== null &&
      (!Number.isFinite(normalizedResponseTimeMs) || normalizedResponseTimeMs < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "responseTimeMs must be a non-negative number",
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
      responseTimeMs: normalizedResponseTimeMs,
      oracleWallet,
      oracleInstanceId,
      remarks,
    });

    await upsertOracleHealth({
      oracleWallet: oracleWallet || responseData.oracleWallet,
      oracleInstanceId: oracleInstanceId || responseData.oracleInstanceId,
      label: responseData.oracleLabel || responseData.label || "",
      registrySnapshot:
        responseData.registrySnapshot || responseData.registryCommitment?.snapshotId || "",
      registryRoot:
        responseData.registryRoot ||
        responseData.registryCommitment?.onChainRoot ||
        responseData.hospitalVerification?.merkleProof?.rootHash ||
        "",
      requestId,
      claimId,
      txHash: submittedTxHash,
      configIdentity: responseData.configIdentity || "",
    });

    const contract = getReadOnlyContract();
    const request = await contract.getOracleRequest(requestId);

    if (request.isFulfilled) {
      const claim = await contract.getClaim(claimId);
      const status = CLAIM_STATUS[Number(claim.status)] || "UNKNOWN";

      await notifyClaimStatusChange({
        claim,
        status,
        transactionHash: submittedTxHash,
        source: `oracle-request-${requestId}`,
        message: `Oracle quorum completed for claim #${claimId}. Final result: ${status.replaceAll("_", " ")}.`,
      });
    }

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

    const rawLogs = await OracleLog.find({
      claimId: req.params.claimId.toString(),
    }).sort({ createdAt: 1 }).lean();
    const contract = getReadOnlyContract();
    const logs = rawLogs.map(formatOracleLog);
    const quorumSummary = await buildQuorumSummary({
      contract,
      claimId: req.params.claimId,
      logs,
    });

    res.status(200).json({
      success: true,
      count: logs.length,
      logs,
      quorumSummary,
    });
  } catch (error) {
    next(error);
  }
};

const recordOracleHeartbeat = async (req, res, next) => {
  try {
    const {
      oracleWallet = "",
      oracleInstanceId = "",
      label = "",
      registrySnapshot = "",
      registryRoot = "",
      lastProcessedRequestId = "",
      lastProcessedClaimId = "",
      lastTxHash = "",
      configIdentity = "",
    } = req.body;

    const health = await upsertOracleHealth({
      oracleWallet,
      oracleInstanceId,
      label,
      registrySnapshot,
      registryRoot,
      requestId: lastProcessedRequestId,
      claimId: lastProcessedClaimId,
      txHash: lastTxHash,
      configIdentity,
    });

    if (!health) {
      return res.status(400).json({
        success: false,
        message: "oracleWallet or oracleInstanceId is required",
      });
    }

    res.status(200).json({
      success: true,
      oracle: formatOracleHealth(health),
    });
  } catch (error) {
    next(error);
  }
};

const getOracleHealth = async (req, res, next) => {
  try {
    const health = await OracleHealth.find({}).sort({ updatedAt: -1 }).lean();

    res.status(200).json({
      success: true,
      count: health.length,
      oracles: health.map(formatOracleHealth),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createOracleLog,
  getOracleLogsByClaim,
  getOracleHealth,
  recordOracleHeartbeat,
};
