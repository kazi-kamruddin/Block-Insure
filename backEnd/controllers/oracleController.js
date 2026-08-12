const OracleLog = require("../models/OracleLog");
const OracleHealth = require("../models/OracleHealth");
const { ethers } = require("ethers");
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

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeHash = (value) => String(value || "").trim().toLowerCase();

const verifyOracleSubmission = async ({
  contract,
  submittedTxHash,
  requestId,
  claimId,
  oracleType,
  resultHash,
  verified,
  riskLevel,
  remarks,
  oracleWallet,
}) => {
  if (!/^0x[a-fA-F0-9]{64}$/.test(String(submittedTxHash || ""))) {
    throw createError("A valid oracle submission transaction hash is required", 400);
  }

  const [receipt, transaction] = await Promise.all([
    contract.runner.getTransactionReceipt(submittedTxHash),
    contract.runner.getTransaction(submittedTxHash),
  ]);

  if (!receipt || !transaction) {
    throw createError("Oracle submission transaction is not available yet", 409);
  }
  if (Number(receipt.status) !== 1) {
    throw createError("Oracle submission transaction failed", 409);
  }
  if (normalizeHash(receipt.to) !== normalizeHash(contract.target)) {
    throw createError("Transaction does not target the configured contract", 400);
  }

  let decoded;
  try {
    decoded = contract.interface.parseTransaction({
      data: transaction.data,
      value: transaction.value,
    });
  } catch {
    throw createError("Transaction calldata is not a contract oracle submission", 400);
  }

  if (!decoded || decoded.name !== "submitOracleResult") {
    throw createError("Transaction is not submitOracleResult", 400);
  }

  const [txRequestId, txVerified, txResultHash, txRiskLevel, txRemarks] =
    decoded.args;
  if (
    txRequestId.toString() !== requestId.toString() ||
    Boolean(txVerified) !== Boolean(verified) ||
    normalizeHash(txResultHash) !== normalizeHash(resultHash) ||
    String(txRiskLevel) !== String(riskLevel) ||
    String(txRemarks) !== String(remarks)
  ) {
    throw createError("Oracle log does not match transaction calldata", 400);
  }

  const confirmation = receipt.logs
    .filter((log) => normalizeHash(log.address) === normalizeHash(contract.target))
    .map((log) => {
      try {
        return contract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((entry) => entry?.name === "OracleConfirmationReceived");

  if (
    !confirmation ||
    confirmation.args.requestId.toString() !== requestId.toString() ||
    confirmation.args.claimId.toString() !== claimId.toString() ||
    Boolean(confirmation.args.verified) !== Boolean(verified) ||
    normalizeHash(confirmation.args.oracle) !== normalizeHash(transaction.from)
  ) {
    throw createError("Oracle confirmation event does not match the log payload", 400);
  }

  const oracleRequest = await contract.getOracleRequest(requestId);
  if (
    oracleRequest.claimId.toString() !== claimId.toString() ||
    String(oracleRequest.oracleType) !== String(oracleType)
  ) {
    throw createError("Oracle log does not match the on-chain request", 400);
  }

  if (oracleWallet && normalizeHash(oracleWallet) !== normalizeHash(transaction.from)) {
    throw createError("Oracle wallet does not match the transaction signer", 400);
  }

  const oracleRole = await contract.ORACLE_ROLE();
  if (
    !(await contract.hasRole(oracleRole, transaction.from, {
      blockTag: receipt.blockNumber,
    }))
  ) {
    throw createError("Transaction signer lacked the oracle role", 403);
  }

  return ethers.getAddress(transaction.from).toLowerCase();
};

const verifyHeartbeat = async ({
  contract,
  oracleWallet,
  oracleInstanceId,
  heartbeatTimestamp,
  heartbeatSignature,
  lastProcessedRequestId,
  lastProcessedClaimId,
  lastTxHash,
}) => {
  if (!ethers.isAddress(oracleWallet)) {
    throw createError("A valid oracle wallet is required", 400);
  }

  const timestamp = new Date(heartbeatTimestamp);
  if (
    Number.isNaN(timestamp.getTime()) ||
    Math.abs(Date.now() - timestamp.getTime()) > 2 * 60 * 1000
  ) {
    throw createError("Oracle heartbeat timestamp is invalid or stale", 401);
  }

  const message = [
    "Block-Insure oracle heartbeat",
    String(oracleInstanceId || ""),
    oracleWallet.toLowerCase(),
    heartbeatTimestamp,
    String(lastProcessedRequestId || ""),
    String(lastProcessedClaimId || ""),
    String(lastTxHash || "").toLowerCase(),
  ].join(":");
  let recoveredWallet;
  try {
    recoveredWallet = ethers.verifyMessage(message, heartbeatSignature);
  } catch {
    throw createError("Oracle heartbeat signature is invalid", 401);
  }

  if (normalizeHash(recoveredWallet) !== normalizeHash(oracleWallet)) {
    throw createError("Oracle heartbeat signer does not match its wallet", 401);
  }

  const oracleRole = await contract.ORACLE_ROLE();
  if (!(await contract.hasRole(oracleRole, recoveredWallet))) {
    throw createError("Heartbeat signer does not have the oracle role", 403);
  }
};

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
  let confirmationsReceived = logs.length;
  let oracleRequest = null;
  let statusLabel = "NO_REQUEST";
  let timedOut = false;

  try {
    oracleRequest = await contract.getOracleRequestByClaimId(claimId);
    const [claim, currentBlock, timeoutBlocks, confirmationCount] = await Promise.all([
      contract.getClaim(claimId),
      contract.runner.getBlockNumber(),
      contract.oracleTimeoutBlocks(),
      contract.oracleConfirmationCount(oracleRequest.requestId),
    ]);
    const requestBlock = Number(oracleRequest.requestBlock);

    confirmationsReceived = Number(confirmationCount);
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
      : confirmationsReceived > 0
        ? "PENDING_QUORUM"
        : "PENDING";

  return {
    requestId: oracleRequest?.requestId?.toString?.() || null,
    confirmationsReceived,
    requiredQuorum,
    metadataLogCount: logs.length,
    verifiedCount,
    failedCount,
    pendingCount: Math.max(requiredQuorum - confirmationsReceived, 0),
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

    const calculatedResultHash = ethers.keccak256(
      ethers.toUtf8Bytes(JSON.stringify(responseData))
    );
    if (normalizeHash(calculatedResultHash) !== normalizeHash(resultHash)) {
      throw createError("Oracle response data does not match its result hash", 400);
    }

    const contract = getReadOnlyContract();
    const verifiedOracleWallet = await verifyOracleSubmission({
      contract,
      submittedTxHash,
      requestId,
      claimId,
      oracleType,
      resultHash,
      verified,
      riskLevel,
      remarks,
      oracleWallet,
    });
    const existingLog = await OracleLog.findOne({ submittedTxHash });

    if (existingLog) {
      return res.status(200).json({
        success: true,
        idempotent: true,
        message: "Oracle log was already recorded",
        oracleLog: existingLog,
      });
    }

    let oracleLog;
    try {
      oracleLog = await OracleLog.create({
        requestId: requestId.toString(),
        claimId: claimId.toString(),
        oracleType,
        queryData: responseData.queryData || queryData,
        responseData,
        resultHash,
        verified,
        riskLevel,
        submittedTxHash,
        responseTimeMs: normalizedResponseTimeMs,
        oracleWallet: verifiedOracleWallet,
        oracleInstanceId,
        remarks,
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      oracleLog = await OracleLog.findOne({ submittedTxHash });
    }

    await upsertOracleHealth({
      oracleWallet: verifiedOracleWallet,
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
      heartbeatTimestamp = "",
      heartbeatSignature = "",
    } = req.body;

    const contract = getReadOnlyContract();
    await verifyHeartbeat({
      contract,
      oracleWallet,
      oracleInstanceId,
      heartbeatTimestamp,
      heartbeatSignature,
      lastProcessedRequestId,
      lastProcessedClaimId,
      lastTxHash,
    });

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
  _verifyHeartbeat: verifyHeartbeat,
  _verifyOracleSubmission: verifyOracleSubmission,
  createOracleLog,
  getOracleLogsByClaim,
  getOracleHealth,
  recordOracleHeartbeat,
};
