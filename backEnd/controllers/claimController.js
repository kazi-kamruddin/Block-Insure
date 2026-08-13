const { ethers } = require("ethers");
const { getReadOnlyContract } = require("../services/contractService");
const { getEvidenceChainForClaim } = require("../services/evidenceChainService");
const ClaimSubmissionAttempt = require("../models/ClaimSubmissionAttempt");
const File = require("../models/File");
const {
  assignEvidenceChainLink,
} = require("../services/evidenceChainService");
const { unpinFromPinata } = require("../services/ipfsService");
const { notifyAdmins } = require("../services/notificationService");
const {
  getClaimIdsByWallet,
  paginate,
  parsePagination,
} = require("../services/contractQueryService");
const {
  evaluatePolicyEligibility,
  getPolicyTerms,
} = require("../services/policyRuleService");
const {
  claimMatchesSubmittedFacts,
} = require("../services/claimSubmissionIntegrityService");

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

/* ----------------------------- Status Map ------------------------------ */

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

const POLICY_STATUS = [
  "PENDING_PAYMENT",
  "ACTIVE",
  "GRACE_PERIOD",
  "LAPSED",
  "CANCELLED",
  "EXPIRED",
  "RENEWED",
];

const canReadClaim = (req, claim) => {
  if (req.user.role === "ADMIN" || req.user.role === "AUDITOR") {
    return true;
  }

  return claim.claimantWallet.toLowerCase() === req.user.walletAddress.toLowerCase();
};

const canVerifyDocumentHash = (req) => {
  return req.user.role === "ADMIN" || req.user.role === "AUDITOR";
};

/* ---------------------- Format Contract Responses ---------------------- */

const formatTimestamp = (timestamp) => {
  const value = Number(timestamp);

  if (!value) {
    return null;
  }

  return {
    unix: value.toString(),
    iso: new Date(value * 1000).toISOString(),
  };
};

const formatClaim = (claim) => {
  const statusNumber = Number(claim.status);

  return {
    claimId: claim.claimId.toString(),
    policyId: claim.policyId.toString(),
    claimantWallet: claim.claimantWallet,
    claimAmountWei: claim.claimAmount.toString(),
    claimAmountEth: ethers.formatEther(claim.claimAmount),
    incidentDate: formatTimestamp(claim.incidentDate),
    claimType: claim.claimType,
    hospitalId: claim.hospitalId,
    invoiceHash: claim.invoiceHash,
    documentHash: claim.documentHash,
    documentCID: claim.documentCID,
    status: {
      code: statusNumber,
      label: CLAIM_STATUS[statusNumber] || "UNKNOWN",
    },
    riskScore: claim.riskScore.toString(),
    submittedAt: formatTimestamp(claim.submittedAt),
  };
};

const formatEnrichedClaim = async (
  contract,
  claim,
  { includeLifecycle = false } = {}
) => {
  const formatted = formatClaim(claim);
  let policyPackageName = "";
  let fraudReason = "";
  let closure = null;
  let policyEligibility = null;

  try {
    const policy = await contract.getPolicy(claim.policyId);
    const policyPackage = await contract.getPolicyPackage(policy.packageId);
    policyPackageName = policyPackage.name;
  } catch {
    // Optional display enrichment must not hide a readable on-chain claim.
  }

  if (formatted.status.label === "FRAUD_FLAGGED") {
    try {
      const events = await contract.queryFilter(
        contract.filters.ClaimFlagged(claim.claimId),
        0,
        "latest"
      );
      fraudReason = events.at(-1)?.args?.reason || "";
    } catch {
      // Older deployments may not support the indexed event filter.
    }
  }

  if (includeLifecycle) {
    try {
      const [resolvedAt, closureWindow, appealed, appealFinalized] =
        await Promise.all([
          contract.claimResolvedAt(claim.claimId),
          contract.claimClosureWindowSeconds(),
          contract.claimAppealed(claim.claimId),
          contract.claimAppealFinalized(claim.claimId),
        ]);
      const resolvedAtSeconds = Number(resolvedAt);
      const closureEligibleAtSeconds = resolvedAtSeconds
        ? resolvedAtSeconds + Number(closureWindow)
        : 0;
      closure = {
        resolvedAt: formatTimestamp(resolvedAt),
        closureWindowSeconds: Number(closureWindow),
        closureEligibleAt: formatTimestamp(closureEligibleAtSeconds),
        appealed: Boolean(appealed),
        appealFinalized: Boolean(appealFinalized),
        canClose:
          formatted.status.label === "SETTLED" ||
          (formatted.status.label === "REJECTED" &&
            (Boolean(appealFinalized) ||
              (closureEligibleAtSeconds > 0 &&
                Math.floor(Date.now() / 1000) >= closureEligibleAtSeconds))),
      };
    } catch {
      // Older deployments can still return the core claim record.
    }
  }

  try {
    const attempt = await ClaimSubmissionAttempt.findOne({
      claimId: formatted.claimId,
      policyId: formatted.policyId,
      walletAddress: formatted.claimantWallet.toLowerCase(),
      status: "COMPLETED",
    })
      .select("policyEligibility submittedFacts")
      .lean();
    if (attempt) {
      policyEligibility = {
        evaluation: attempt.policyEligibility,
        submittedFacts: attempt.submittedFacts,
      };
    }
  } catch {
    // On-chain claims remain readable if optional advisory metadata is unavailable.
  }

  return {
    ...formatted,
    policyPackageName,
    displayTitle: `${formatted.claimType || "Insurance"} claim${
      formatted.hospitalId ? ` — ${formatted.hospitalId}` : ""
    }`,
    fraudReason,
    riskScoreAvailable: formatted.status.label !== "FRAUD_FLAGGED",
    closure,
    policyEligibility,
  };
};

const formatClaimDocument = (document) => {
  return {
    documentHash: document.documentHash,
    documentCID: document.documentCID,
    uploadedAt: formatTimestamp(document.uploadedAt),
    documentType: document.documentType,
  };
};

/* ----------------------------- Controllers ----------------------------- */

const getMyClaims = async (req, res, next) => {
  try {
    const contract = getReadOnlyContract();

    const allClaimIds = await getClaimIdsByWallet(
      contract,
      req.user.walletAddress
    );
    const { items: claimIds, pagination } = paginate(
      allClaimIds,
      parsePagination(req.query)
    );

    const claims = await Promise.all(
      claimIds.map(async (claimId) => {
        const claim = await contract.getClaim(claimId);
        return formatEnrichedClaim(contract, claim);
      })
    );

    res.status(200).json({
      success: true,
      count: claims.length,
      pagination,
      claims,
    });
  } catch (error) {
    next(error);
  }
};

const getReadableClaims = async (req, res, next) => {
  try {
    if (req.user.role !== "ADMIN" && req.user.role !== "AUDITOR") {
      return res.status(403).json({
        success: false,
        message: "Access denied: admin or auditor role is required",
      });
    }

    const contract = getReadOnlyContract();
    const nextClaimId = Number(await contract.claimCounter());
    const allClaimIds = Array.from(
      { length: Math.max(nextClaimId - 1, 0) },
      (_, index) => BigInt(index + 1)
    );
    const { items: claimIds, pagination } = paginate(
      allClaimIds,
      parsePagination(req.query)
    );
    const claims = await Promise.all(
      claimIds.map(async (claimId) =>
        formatEnrichedClaim(contract, await contract.getClaim(claimId))
      )
    );

    res.status(200).json({
      success: true,
      count: claims.length,
      pagination,
      claims,
    });
  } catch (error) {
    next(error);
  }
};

const getClaimById = async (req, res, next) => {
  try {
    const contract = getReadOnlyContract();

    const claim = await contract.getClaim(req.params.claimId);

    if (!canReadClaim(req, claim)) {
      return res.status(403).json({
        success: false,
        message: "Access denied: claim does not belong to this wallet",
      });
    }

    const documents = await contract.getClaimDocuments(req.params.claimId);
    const evidenceChain = await getEvidenceChainForClaim(req.params.claimId);

    res.status(200).json({
      success: true,
      claim: await formatEnrichedClaim(contract, claim, {
        includeLifecycle: true,
      }),
      documents: documents.map(formatClaimDocument),
      evidenceChain,
    });
  } catch (error) {
    next(error);
  }
};

const getClaimDocumentHash = async (req, res, next) => {
  try {
    if (!canVerifyDocumentHash(req)) {
      return res.status(403).json({
        success: false,
        message: "Access denied: auditor or admin role is required",
      });
    }

    const contract = getReadOnlyContract();
    const claimId = BigInt(req.params.claimId);
    const claim = await contract.getClaim(claimId);
    const linkedDocuments = await File.find({
      claimId: claimId.toString(),
      status: "PINNED",
    }).sort({ evidenceChainIndex: 1, createdAt: 1 });
    const requestedDocumentId = String(req.query.documentId || "").trim();
    const selectedDocument = requestedDocumentId
      ? linkedDocuments.find(
          (document) => document._id.toString() === requestedDocumentId
        )
      : null;

    if (requestedDocumentId && !selectedDocument) {
      return res.status(404).json({
        success: false,
        message: "Selected evidence document is not linked to this claim",
      });
    }

    let blockNumber = null;

    try {
      const filter = contract.filters.ClaimSubmitted(claimId);
      const logs = await contract.queryFilter(filter, 0, "latest");
      blockNumber = logs[0]?.blockNumber ?? null;
    } catch (eventError) {
      console.warn(
        "Could not resolve claim document commit block:",
        eventError.message
      );
    }

    res.status(200).json({
      success: true,
      claimId: claim.claimId.toString(),
      claimantWallet: claim.claimantWallet,
      documentHash: selectedDocument?.sha256Hash || claim.documentHash,
      documentCID: selectedDocument?.ipfsCID || claim.documentCID,
      documentId: selectedDocument?._id || null,
      documentName: selectedDocument?.originalName || "Original claim evidence",
      commitmentSource: selectedDocument
        ? "BACKEND_EVIDENCE_CHAIN"
        : "ON_CHAIN_CLAIM",
      evidenceOptions: linkedDocuments.map((document) => ({
        id: document._id,
        name: document.originalName,
        documentType: document.documentType,
        evidenceChainIndex: document.evidenceChainIndex,
      })),
      submittedAt: formatTimestamp(claim.submittedAt),
      blockNumber,
    });
  } catch (error) {
    next(error);
  }
};

const authorizeClaimSubmission = async (req, res, next) => {
  try {
    const policyId = String(req.body.policyId || "").trim();

    if (!/^\d+$/.test(policyId) || BigInt(policyId) === 0n) {
      return res.status(400).json({
        success: false,
        message: "policyId must be a positive integer",
      });
    }

    const contract = getReadOnlyContract();
    const [policy, effectiveStatus] = await Promise.all([
      contract.getPolicy(policyId),
      contract.getEffectivePolicyStatus(policyId),
    ]);

    if (policy.holderWallet.toLowerCase() !== req.user.walletAddress.toLowerCase()) {
      return res.status(403).json({
        success: false,
        message: "Access denied: policy does not belong to this wallet",
      });
    }

    const statusCode = Number(effectiveStatus);
    const statusLabel = POLICY_STATUS[statusCode] || "UNKNOWN";

    if (statusLabel !== "ACTIVE") {
      return res.status(409).json({
        success: false,
        message:
          statusLabel === "GRACE_PERIOD" || statusLabel === "LAPSED"
            ? "Policy premium is overdue and cannot submit claims"
            : `Policy is not active (${statusLabel})`,
        policyStatus: { code: statusCode, label: statusLabel },
      });
    }

    const maximumPerDay = Number(process.env.CLAIMS_PER_WALLET_24H || 3);
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const attemptQuery = {
      walletAddress: req.user.walletAddress,
      createdAt: { $gte: windowStart },
      status: { $nin: ["ABANDONED", "FAILED"] },
    };
    const [recentAttempts, oldestActiveAttempt] = await Promise.all([
      ClaimSubmissionAttempt.countDocuments(attemptQuery),
      ClaimSubmissionAttempt.findOne(attemptQuery).sort({ createdAt: 1 }),
    ]);

    if (maximumPerDay > 0 && recentAttempts >= maximumPerDay) {
      const resetAt = new Date(
        new Date(oldestActiveAttempt?.createdAt || Date.now()).getTime() +
          24 * 60 * 60 * 1000
      );
      const retryAfterSeconds = Math.max(
        Math.ceil((resetAt.getTime() - Date.now()) / 1000),
        1
      );
      res.set("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        success: false,
        message: `Wallet claim submission limit reached (${maximumPerDay} per 24 hours).`,
        limit: maximumPerDay,
        resetAt: resetAt.toISOString(),
        retryAfterSeconds,
        devResetAvailable:
          process.env.NODE_ENV !== "production" &&
          process.env.DEV_ALLOW_CLAIM_LIMIT_RESET === "true",
      });
    }

    if (
      req.body.incidentDate === undefined ||
      !String(req.body.claimType || "").trim() ||
      (req.body.claimAmountWei === undefined && req.body.claimAmountEth === undefined)
    ) {
      throw createError(
        "incidentDate, claimType, and claimAmount are required for the auditable eligibility snapshot"
      );
    }

    const policyPackage = await contract.getPolicyPackage(policy.packageId);
    let claimAmountWei;
    try {
      claimAmountWei =
        req.body.claimAmountWei !== undefined
          ? BigInt(String(req.body.claimAmountWei)).toString()
          : ethers.parseEther(String(req.body.claimAmountEth)).toString();
      if (BigInt(claimAmountWei) <= 0n) throw new Error("non-positive");
    } catch {
      throw createError("Claim amount must be greater than zero", 400);
    }
    const submittedFacts = {
      incidentDate: String(req.body.incidentDate),
      claimType: String(req.body.claimType).trim(),
      claimAmountWei,
      preExistingCondition: req.body.preExistingCondition === true,
      disclosedAtPurchase: req.body.disclosedAtPurchase === true,
    };
    const policyEligibility = evaluatePolicyEligibility({
      terms: getPolicyTerms(policyPackage),
      policyStartDate: policy.startDate.toString(),
      policyEndDate: policy.endDate.toString(),
      incidentDate: submittedFacts.incidentDate,
      claimType: submittedFacts.claimType,
      claimAmountWei: submittedFacts.claimAmountWei,
      coverageAmountWei: policy.coverageAmount.toString(),
      preExistingCondition: submittedFacts.preExistingCondition,
      disclosedAtPurchase: submittedFacts.disclosedAtPurchase,
    });
    const canonicalIncidentDate = Math.floor(
      Date.parse(policyEligibility.dates.incidentDate) / 1000
    );
    if (
      canonicalIncidentDate < Number(policy.startDate) ||
      canonicalIncidentDate > Number(policy.endDate)
    ) {
      throw createError("Incident date is outside the policy coverage period");
    }
    if (canonicalIncidentDate > Math.floor(Date.now() / 1000)) {
      throw createError("Incident date cannot be in the future");
    }
    if (BigInt(claimAmountWei) > policy.coverageAmount) {
      throw createError("Claim amount cannot exceed policy coverage");
    }
    submittedFacts.incidentDate = String(canonicalIncidentDate);

    const attempt = await ClaimSubmissionAttempt.create({
      walletAddress: req.user.walletAddress,
      policyId,
      submittedFacts,
      policyEligibility,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    res.status(200).json({
      success: true,
      message: "Claim submission authorized",
      attemptId: attempt._id,
      remainingToday:
        maximumPerDay > 0
          ? Math.max(maximumPerDay - recentAttempts - 1, 0)
          : null,
      policyStatus: { code: statusCode, label: statusLabel },
      policyEligibility,
    });
  } catch (error) {
    next(error);
  }
};

const resetMyClaimSubmissionLimit = async (req, res, next) => {
  try {
    if (
      process.env.NODE_ENV === "production" ||
      process.env.DEV_ALLOW_CLAIM_LIMIT_RESET !== "true"
    ) {
      throw createError("Development claim-limit reset is disabled", 403);
    }

    const result = await ClaimSubmissionAttempt.deleteMany({
      walletAddress: req.user.walletAddress,
      status: { $in: ["AUTHORIZED", "UPLOADED", "COMPLETED"] },
    });

    res.status(200).json({
      success: true,
      message: "Development claim submission limit reset",
      removedAttempts: result.deletedCount,
    });
  } catch (error) {
    next(error);
  }
};

const getOwnedAttempt = async (attemptId, walletAddress) => {
  if (!/^[a-f\d]{24}$/i.test(String(attemptId || ""))) {
    throw createError("A valid claim submission attempt id is required", 400);
  }

  const attempt = await ClaimSubmissionAttempt.findOne({
    _id: attemptId,
    walletAddress,
  });

  if (!attempt) {
    throw createError("Claim submission attempt not found", 404);
  }

  return attempt;
};

const recordClaimTransaction = async (req, res, next) => {
  try {
    const transactionHash = String(req.body.transactionHash || "").trim();

    if (!/^0x[a-f\d]{64}$/i.test(transactionHash)) {
      throw createError("A valid transactionHash is required", 400);
    }

    const attempt = await getOwnedAttempt(
      req.params.attemptId,
      req.user.walletAddress
    );

    if (attempt.status === "COMPLETED") {
      return res.status(200).json({ success: true, attempt });
    }

    if (!["UPLOADED", "TX_SUBMITTED"].includes(attempt.status)) {
      throw createError(`Attempt cannot record a transaction from ${attempt.status}`, 409);
    }

    if (
      attempt.transactionHash &&
      attempt.transactionHash.toLowerCase() !== transactionHash.toLowerCase()
    ) {
      throw createError("Attempt is already bound to another transaction", 409);
    }

    attempt.transactionHash = transactionHash;
    attempt.status = "TX_SUBMITTED";
    await attempt.save();

    res.status(200).json({ success: true, attempt });
  } catch (error) {
    next(error);
  }
};

const reconcileClaimSubmission = async (req, res, next) => {
  try {
    const attempt = await getOwnedAttempt(
      req.params.attemptId,
      req.user.walletAddress
    );

    if (attempt.status === "COMPLETED") {
      return res.status(200).json({
        success: true,
        message: "Claim submission was already reconciled",
        attempt,
      });
    }

    if (attempt.status !== "TX_SUBMITTED" || !attempt.transactionHash) {
      throw createError("Attempt does not have a submitted transaction", 409);
    }

    const contract = getReadOnlyContract();
    const receipt = await contract.runner.getTransactionReceipt(
      attempt.transactionHash
    );

    if (!receipt) {
      return res.status(202).json({
        success: false,
        pending: true,
        message: "Transaction is still pending",
      });
    }

    if (Number(receipt.status) !== 1) {
      attempt.status = "FAILED";
      attempt.failureReason = "Blockchain transaction reverted";
      await attempt.save();
      throw createError("Claim transaction reverted", 409);
    }

    let claimId = "";

    for (const log of receipt.logs) {
      try {
        const parsedLog = contract.interface.parseLog(log);

        if (parsedLog?.name === "ClaimSubmitted") {
          claimId = parsedLog.args.claimId.toString();
          break;
        }
      } catch {
        // Ignore unrelated logs.
      }
    }

    if (!claimId) {
      throw createError("Confirmed transaction did not submit a claim", 409);
    }

    const [claim, fileRecord] = await Promise.all([
      contract.getClaim(claimId),
      File.findById(attempt.documentId),
    ]);

    if (!fileRecord) {
      throw createError("Attempt document record is missing", 409);
    }

    if (
      claim.claimantWallet.toLowerCase() !== req.user.walletAddress.toLowerCase() ||
      claim.policyId.toString() !== attempt.policyId
    ) {
      throw createError("Confirmed claim does not match the authorized attempt", 409);
    }

    if (!claimMatchesSubmittedFacts(claim, attempt.submittedFacts)) {
      throw createError(
        "Confirmed claim facts do not match the eligibility snapshot",
        409
      );
    }

    const expectedDocumentHash = `0x${fileRecord.sha256Hash}`.toLowerCase();

    if (
      claim.documentHash.toLowerCase() !== expectedDocumentHash ||
      claim.documentCID !== fileRecord.ipfsCID
    ) {
      throw createError("Confirmed claim evidence does not match the uploaded document", 409);
    }

    await assignEvidenceChainLink(fileRecord, claimId);

    attempt.claimId = claimId;
    attempt.status = "COMPLETED";
    attempt.completedAt = new Date();
    attempt.expiresAt = null;
    attempt.failureReason = "";
    await attempt.save();

    await notifyAdmins({
      actorWallet: req.user.walletAddress,
      type: "CLAIM_SUBMITTED",
      title: `New claim #${claimId}`,
      message: `A new claim was submitted and its encrypted evidence was reconciled.`,
      claimId,
      link: `/admin/claims/${claimId}`,
      dedupeKey: `claim:${claimId}:submitted`,
    });

    res.status(200).json({
      success: true,
      message: "Claim transaction and encrypted evidence reconciled",
      attempt,
      claimId,
    });
  } catch (error) {
    next(error);
  }
};

const abandonClaimSubmission = async (req, res, next) => {
  try {
    const attempt = await getOwnedAttempt(
      req.params.attemptId,
      req.user.walletAddress
    );

    if (!["AUTHORIZED", "UPLOADED"].includes(attempt.status)) {
      throw createError(`Attempt cannot be abandoned from ${attempt.status}`, 409);
    }

    if (attempt.documentId) {
      const fileRecord = await File.findById(attempt.documentId);

      if (fileRecord) {
        await unpinFromPinata(fileRecord.ipfsCID);
        await File.deleteOne({ _id: fileRecord._id });
      }
    }

    attempt.status = "ABANDONED";
    attempt.failureReason = String(req.body.reason || "Cancelled before submission");
    await attempt.save();

    res.status(200).json({
      success: true,
      message: "Unused evidence was unpinned and the attempt was abandoned",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  authorizeClaimSubmission,
  abandonClaimSubmission,
  getReadableClaims,
  getMyClaims,
  getClaimById,
  getClaimDocumentHash,
  reconcileClaimSubmission,
  recordClaimTransaction,
  resetMyClaimSubmissionLimit,
};
