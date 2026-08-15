const { ethers } = require("ethers");
const InsuranceManagerArtifact = require("../abi/InsuranceManager.json");
const OracleCoordinatorArtifact = require("../abi/OracleCoordinator.json");
const ClaimAdjudicatorArtifact = require("../abi/ClaimAdjudicator.json");
const AdminActionLog = require("../models/AdminActionLog");
const Appeal = require("../models/Appeal");
const OracleLog = require("../models/OracleLog");
const {
  getProvider,
  getContractAddress,
  getOracleCoordinator,
  getClaimAdjudicator,
  getReadOnlyContract,
} = require("../services/contractService");

const CLAIM_EVENT_NAMES = new Set([
  "ClaimSubmitted",
  "DocumentAdded",
  "ClaimFlagged",
  "OracleRequested",
  "OracleConfirmationReceived",
  "OracleResultSubmitted",
  "OracleTimedOut",
  "OracleCommitmentSubmitted",
  "OracleResultRevealed",
  "OracleRequestFinalized",
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
  "ManualReviewOpened",
  "ManualReviewFinalized",
  "PayoutRecorded",
  "PayoutFunded",
  "PayoutWithdrawn",
  "DecisionRecorded",
  "AppealStarted",
  "AuditorReputationObserved",
  "PayoutAllocated",
  "ClaimFundingRequired",
  "ClaimFundingActivated",
  "SettlementWithdrawn",
  "ClaimDecisionRecorded",
]);

const serializeValue = (value) => {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serializeValue);

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => Number.isNaN(Number(key)))
        .map(([key, nestedValue]) => [key, serializeValue(nestedValue)])
    );
  }

  return value;
};

const getClaimIdFromParsedLog = (parsedLog) => {
  if (!parsedLog?.args || parsedLog.args.claimId === undefined) return null;
  return parsedLog.args.claimId.toString();
};

const safeContractCall = async (callback, fallback = null) => {
  try {
    return await callback();
  } catch (_) {
    return fallback;
  }
};

const buildClaimTimeline = async (id) => {
  const provider = getProvider();
  const contractAddress = getContractAddress();
  const contract = getReadOnlyContract();
  const coordinator = await getOracleCoordinator(contract);
  const adjudicator = await getClaimAdjudicator(contract);
  const coordinatorAddress = await coordinator.getAddress();
  const adjudicatorAddress = await adjudicator.getAddress();
  const interfaces = new Map([
    [contractAddress.toLowerCase(), new ethers.Interface(InsuranceManagerArtifact.abi)],
    [coordinatorAddress.toLowerCase(), new ethers.Interface(OracleCoordinatorArtifact.abi)],
    [adjudicatorAddress.toLowerCase(), new ethers.Interface(ClaimAdjudicatorArtifact.abi)],
  ]);
  const latestBlock = await provider.getBlockNumber();
  const logs = await provider.getLogs({
    address: [contractAddress, coordinatorAddress, adjudicatorAddress],
    fromBlock: 0,
    toBlock: latestBlock,
  });
  const blockTimestampCache = new Map();
  const timeline = [];

  for (const log of logs) {
    let parsedLog;

    try {
      parsedLog = interfaces.get(log.address.toLowerCase()).parseLog(log);
    } catch (_) {
      continue;
    }

    if (!parsedLog || !CLAIM_EVENT_NAMES.has(parsedLog.name)) continue;

    let eventClaimId = getClaimIdFromParsedLog(parsedLog);
    if (eventClaimId === null && parsedLog.args.requestId !== undefined) {
      const request = await safeContractCall(() =>
        coordinator.getRequest(parsedLog.args.requestId)
      );
      eventClaimId = request?.claimId?.toString?.() || null;
    }

    if (eventClaimId !== id.toString()) continue;

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

  return timeline.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
    return a.logIndex - b.logIndex;
  });
};

const formatClaimExport = (claim) => {
  if (!claim) return null;

  return {
    claimId: claim.claimId.toString(),
    policyId: claim.policyId.toString(),
    claimantWallet: claim.claimantWallet,
    claimAmountWei: claim.claimAmount.toString(),
    claimAmountEth: ethers.formatEther(claim.claimAmount),
    claimType: claim.claimType,
    hospitalId: claim.hospitalId,
    invoiceHash: claim.invoiceHash,
    documentHash: claim.documentHash,
    documentCID: claim.documentCID,
    statusCode: Number(claim.status),
      verificationConfidence: claim.verificationConfidence.toString(),
    submittedAt: claim.submittedAt.toString(),
  };
};

const formatSettlementExport = (settlement) => {
  if (!settlement) return null;

  return {
    claimId: settlement.claimId.toString(),
    recipient: settlement.recipient,
    amountWei: settlement.amount.toString(),
    amountEth: ethers.formatEther(settlement.amount),
    settledAt: settlement.settledAt.toString(),
  };
};

const buildClaimExport = async (id) => {
  const contract = getReadOnlyContract();
  const [claim, timeline, oracleLogs, adminActions, appeal, settlementRecord] =
    await Promise.all([
      safeContractCall(() => contract.getClaim(id)),
      buildClaimTimeline(id),
      OracleLog.find({ claimId: id.toString() }).sort({ createdAt: 1 }).lean(),
      AdminActionLog.find({ targetType: "CLAIM", targetId: id.toString() })
        .sort({ createdAt: 1 })
        .lean(),
      Appeal.findOne({ claimId: id.toString() }).lean(),
      safeContractCall(() => contract.getSettlementRecord(id)),
    ]);
  const oracleEvents = oracleLogs.map((log) => ({
    requestId: log.requestId,
    oracleWallet: log.oracleWallet,
    oracleInstanceId: log.oracleInstanceId,
    verified: log.verified,
    riskLevel: log.riskLevel,
    remarks: log.remarks,
    resultHash: log.resultHash,
    txHash: log.submittedTxHash,
    registryRoot:
      log.responseData?.registryRoot ||
      log.responseData?.registryCommitment?.onChainRoot ||
      log.responseData?.hospitalVerification?.merkleProof?.rootHash ||
      "",
    createdAt: log.createdAt,
  }));

  return {
    exportedAt: new Date().toISOString(),
    privacy:
      "Contains hashes, CIDs, event metadata, and decisions only. Raw medical/NID/private document content is excluded.",
    claim: formatClaimExport(claim),
    policyId: claim?.policyId?.toString?.() || null,
    claimantWallet: claim?.claimantWallet || "",
    document: claim
      ? {
          documentHash: claim.documentHash,
          documentCID: claim.documentCID,
          invoiceHash: claim.invoiceHash,
        }
      : null,
    duplicateFlag: timeline.some((event) => event.eventName === "ClaimFlagged"),
    statusTimeline: timeline,
    oracleEvents,
    merkleInfo: oracleEvents
      .filter((event) => event.registryRoot)
      .map((event) => ({
        requestId: event.requestId,
        oracleWallet: event.oracleWallet,
        registryRoot: event.registryRoot,
      })),
    adminActions: adminActions.map((action) => ({
      action: action.action,
      actorWallet: action.actorWallet,
      actorRole: action.actorRole,
      transactionHash: action.transactionHash,
      blockNumber: action.blockNumber,
      route: `${action.request?.method || ""} ${action.request?.path || ""}`.trim(),
      metadata: action.metadata,
      timestamp: action.createdAt,
    })),
    auditorVotes: timeline
      .filter((event) => event.eventName === "AuditorVoteCast")
      .map((event) => event.args),
    appealHistory: appeal
      ? {
          status: appeal.status,
          reasonCategory: appeal.reasonCategory,
          appealReasonHash: appeal.appealReasonHash,
          additionalDocumentHash: appeal.additionalDocumentHash,
          additionalDocumentCID: appeal.additionalDocumentCID,
          adminNote: appeal.adminNote,
          auditorRecommendation: appeal.auditorRecommendation,
          finalRejectionReason: appeal.finalRejectionReason,
          history: appeal.history,
        }
      : null,
    settlement: formatSettlementExport(settlementRecord),
    closureEvent: timeline.find((event) => event.eventName === "ClaimClosed") || null,
  };
};

const toMarkdown = (claimExport) => {
  const lines = [
    `# Claim ${claimExport.claim?.claimId || ""} Lifecycle Export`,
    "",
    claimExport.privacy,
    "",
    "## Claim",
    `- Policy ID: ${claimExport.policyId || "N/A"}`,
    `- Claimant wallet: ${claimExport.claimantWallet || "N/A"}`,
    `- Document hash: ${claimExport.document?.documentHash || "N/A"}`,
    `- Document CID: ${claimExport.document?.documentCID || "N/A"}`,
    `- Duplicate flag: ${claimExport.duplicateFlag ? "yes" : "no"}`,
    "",
    "## Timeline",
    ...claimExport.statusTimeline.map(
      (event) =>
        `- ${event.timestamp?.iso || ""} | ${event.eventName} | block ${event.blockNumber} | ${event.transactionHash}`
    ),
    "",
    "## Oracle Events",
    ...claimExport.oracleEvents.map(
      (event) =>
        `- Request ${event.requestId}: ${event.verified ? "verified" : "failed"} by ${event.oracleWallet || "unknown"} (${event.riskLevel || "N/A"})`
    ),
    "",
    "## Admin Actions",
    ...claimExport.adminActions.map(
      (action) =>
        `- ${action.timestamp || ""}: ${action.action} by ${action.actorWallet || "unknown"} tx ${action.transactionHash || "N/A"}`
    ),
    "",
    "## Settlement",
    claimExport.settlement
      ? `- Paid ${claimExport.settlement.amountEth} ETH to ${claimExport.settlement.recipient}`
      : "- No settlement record found",
  ];

  return `${lines.join("\n")}\n`;
};

const getClaimAuditTimeline = async (req, res, next) => {
  try {
    const { id } = req.params;
    const timeline = await buildClaimTimeline(id);

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

const exportClaimAuditTimeline = async (req, res, next) => {
  try {
    const { id } = req.params;
    const format = String(req.query.format || "json").toLowerCase();
    const claimExport = await buildClaimExport(id);

    if (format === "markdown" || format === "md") {
      res.setHeader("Content-Disposition", `attachment; filename="claim-${id}-timeline.md"`);
      res.type("text/markdown").send(toMarkdown(claimExport));
      return;
    }

    res.setHeader("Content-Disposition", `attachment; filename="claim-${id}-timeline.json"`);
    res.status(200).json({
      success: true,
      export: claimExport,
    });
  } catch (error) {
    next(error);
  }
};

const getAdminActionLogs = async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit || 100), 500);
    const action = req.query.action || undefined;
    const targetType = req.query.targetType || undefined;
    const targetId = req.query.targetId || undefined;
    const filter = {};

    if (action) filter.action = action;
    if (targetType) filter.targetType = targetType;
    if (targetId) filter.targetId = targetId.toString();

    const logs = await AdminActionLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

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
  exportClaimAuditTimeline,
  getAdminActionLogs,
  getClaimAuditTimeline,
};
