const { ethers } = require("ethers");
const InsuranceManagerArtifact = require("../abi/InsuranceManager.json");
const {
  getProvider,
  getContractAddress,
} = require("../services/contractService");

/* ----------------------------- Event Names ----------------------------- */

const CLAIM_EVENT_NAMES = new Set([
  "ClaimSubmitted",
  "DocumentAdded",
  "ClaimFlagged",
  "OracleRequested",
  "OracleConfirmationReceived",
  "OracleResultSubmitted",
  "ClaimApproved",
  "ClaimRejected",
  "ClaimAppealed",
  "ClaimReopenedAfterAppeal",
  "ClaimAppealFinalized",
  "ClaimSentToManualReview",
  "AuditorVoteCast",
  "SettlementCalculated",
  "ClaimSettled",
  "ClaimClosed",
]);

/* ----------------------------- Utilities ------------------------------- */

const serializeValue = (value) => {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }

  if (value && typeof value === "object") {
    const output = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      if (!Number.isNaN(Number(key))) {
        continue;
      }

      output[key] = serializeValue(nestedValue);
    }

    return output;
  }

  return value;
};

const getClaimIdFromParsedLog = (parsedLog) => {
  if (!parsedLog || !parsedLog.args) {
    return null;
  }

  if (parsedLog.args.claimId !== undefined) {
    return parsedLog.args.claimId.toString();
  }

  return null;
};

/* ----------------------------- Controller ------------------------------ */

const getClaimAuditTimeline = async (req, res, next) => {
  try {
    const { id } = req.params;

    const provider = getProvider();
    const contractAddress = getContractAddress();
    const contractInterface = new ethers.Interface(InsuranceManagerArtifact.abi);

    const latestBlock = await provider.getBlockNumber();

    const logs = await provider.getLogs({
      address: contractAddress,
      fromBlock: 0,
      toBlock: latestBlock,
    });

    const blockTimestampCache = new Map();
    const timeline = [];

    for (const log of logs) {
      let parsedLog;

      try {
        parsedLog = contractInterface.parseLog(log);
      } catch (_) {
        continue;
      }

      if (!parsedLog || !CLAIM_EVENT_NAMES.has(parsedLog.name)) {
        continue;
      }

      const eventClaimId = getClaimIdFromParsedLog(parsedLog);

      if (eventClaimId !== id.toString()) {
        continue;
      }

      let blockTimestamp = blockTimestampCache.get(log.blockNumber);

      if (!blockTimestamp) {
        const block = await provider.getBlock(log.blockNumber);
        blockTimestamp = block.timestamp;
        blockTimestampCache.set(log.blockNumber, blockTimestamp);
      }

      timeline.push({
        eventName: parsedLog.name,
        claimId: eventClaimId,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        logIndex: log.index ?? log.logIndex,
        timestamp: {
          unix: blockTimestamp.toString(),
          iso: new Date(blockTimestamp * 1000).toISOString(),
        },
        args: serializeValue(parsedLog.args),
      });
    }

    timeline.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) {
        return a.blockNumber - b.blockNumber;
      }

      return a.logIndex - b.logIndex;
    });

    res.status(200).json({
      success: true,
      claimId: id.toString(),
      count: timeline.length,
      timeline,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getClaimAuditTimeline,
};
