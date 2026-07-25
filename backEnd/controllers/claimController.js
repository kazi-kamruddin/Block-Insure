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
        return formatClaim(claim);
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
        formatClaim(await contract.getClaim(claimId))
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
      claim: formatClaim(claim),
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
      documentHash: claim.documentHash,
      documentCID: claim.documentCID,
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
    const recentAttempts = await ClaimSubmissionAttempt.countDocuments({
      walletAddress: req.user.walletAddress,
      createdAt: { $gte: windowStart },
      status: { $nin: ["ABANDONED", "FAILED"] },
    });

    if (recentAttempts >= maximumPerDay) {
      return res.status(429).json({
        success: false,
        message: `Wallet claim submission limit reached (${maximumPerDay} per 24 hours).`,
      });
    }

    const attempt = await ClaimSubmissionAttempt.create({
      walletAddress: req.user.walletAddress,
      policyId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    res.status(200).json({
      success: true,
      message: "Claim submission authorized",
      attemptId: attempt._id,
      remainingToday: Math.max(maximumPerDay - recentAttempts - 1, 0),
      policyStatus: { code: statusCode, label: statusLabel },
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
};
