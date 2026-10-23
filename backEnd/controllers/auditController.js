const { ethers } = require("ethers");
const AdminActionLog = require("../models/AdminActionLog");
const Appeal = require("../models/Appeal");
const OracleLog = require("../models/OracleLog");
const HospitalClaimVerification = require("../models/HospitalClaimVerification");
const {
  getProvider,
  getContractAddress,
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
  "HospitalClaimVerified",
]);

const safeContractCall = async (callback, fallback = null) => {
  try {
    return await callback();
  } catch (_) {
    return fallback;
  }
};

const buildClaimTimeline = async (id) => {
  const { indexConfirmedEvents, getIndexerContext } = require("../services/blockchainIndexerService");
  const IndexedEvent = require("../models/IndexedBlockchainEvent");
  const provider = getProvider();
  await indexConfirmedEvents();
  const { indexerId } = await getIndexerContext(provider);
  const direct = await IndexedEvent.find({ indexerId, "args.claimId": String(id) }).select("args.requestId").lean();
  const requestIds = [...new Set(direct.map((event) => event.args?.requestId).filter(Boolean))];
  const events = await IndexedEvent.find({ indexerId, $or: [
    { "args.claimId": String(id) }, { "args.requestId": { $in: requestIds } },
  ] }).sort({ blockNumber: 1, logIndex: 1 }).limit(1001).lean();
  if (events.length > 1000) throw Object.assign(new Error("Claim timeline exceeds the export limit"), { statusCode: 413 });
  const blocks = new Map();
  const timeline = [];
  for (const event of events) {
    if (!CLAIM_EVENT_NAMES.has(event.eventName)) continue;
    if (!blocks.has(event.blockNumber)) blocks.set(event.blockNumber, await provider.getBlock(event.blockNumber));
    const block = blocks.get(event.blockNumber);
    if (!block || block.hash !== event.blockHash) throw Object.assign(new Error("Timeline is catching up with the chain"), { statusCode: 503 });
    timeline.push({ eventName: event.eventName, claimId: String(id), blockNumber: event.blockNumber,
      transactionHash: event.transactionHash, logIndex: event.logIndex,
      timestamp: { unix: String(block.timestamp), iso: new Date(block.timestamp * 1000).toISOString() },
      args: event.args });
  }
  return timeline;
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
  const [claim, timeline, oracleLogs, adminActions, appeal, settlementRecord, hospitalVerification] =
    await Promise.all([
      safeContractCall(() => contract.getClaim(id)),
      buildClaimTimeline(id),
      OracleLog.find({ claimId: id.toString() }).sort({ createdAt: 1 }).lean(),
      AdminActionLog.find({ targetType: "CLAIM", targetId: id.toString() })
        .sort({ createdAt: 1 })
        .lean(),
      Appeal.findOne({ claimId: id.toString() }).lean(),
      safeContractCall(() => contract.getSettlementRecord(id)),
      HospitalClaimVerification.findOne({ claimId: id.toString() })
        .sort({ claimVersion: -1 })
        .lean(),
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
    hospitalVerification,
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
    "## Hospital Verification",
    claimExport.hospitalVerification
      ? `- ${claimExport.hospitalVerification.outcome} by ${claimExport.hospitalVerification.hospitalWallet} tx ${claimExport.hospitalVerification.transactionHash}`
      : "- Pending hospital verification",
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
