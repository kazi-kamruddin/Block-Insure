const crypto = require("crypto");
const Appeal = require("../models/Appeal");
const { getReadOnlyContract } = require("../services/contractService");
const {
  notifyAdmins,
  notifyWallet,
} = require("../services/notificationService");

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

const APPEAL_STATUSES = new Set([
  "PENDING",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
]);

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const sha256Text = (value) =>
  `0x${crypto.createHash("sha256").update(value, "utf8").digest("hex")}`;

const normalizeClaimId = (claimId) => String(claimId || "").trim();

const buildAppealDeadline = async (contract, claimId) => {
  try {
    const resolvedAt = await contract.claimResolvedAt(claimId);
    const closureWindow = await contract.claimClosureWindowSeconds();

    if (!Number(resolvedAt)) return null;

    return new Date((Number(resolvedAt) + Number(closureWindow)) * 1000);
  } catch {
    return null;
  }
};

const formatAppeal = (appeal) => {
  if (!appeal) return null;

  return {
    id: appeal._id,
    claimId: appeal.claimId,
    claimantWallet: appeal.claimantWallet,
    appealReason: appeal.appealReason,
    reasonCategory: appeal.reasonCategory,
    appealDescription: appeal.appealDescription,
    appealReasonHash: appeal.appealReasonHash,
    additionalDocumentHash: appeal.additionalDocumentHash,
    additionalDocumentCID: appeal.additionalDocumentCID,
    status: appeal.status,
    adminNote: appeal.adminNote,
    auditorRecommendation: appeal.auditorRecommendation,
    finalRejectionReason: appeal.finalRejectionReason,
    appealDeadline: appeal.appealDeadline,
    history: appeal.history || [],
    transactionHash: appeal.transactionHash,
    submittedAt: appeal.submittedAt,
    reviewedAt: appeal.reviewedAt,
    createdAt: appeal.createdAt,
    updatedAt: appeal.updatedAt,
  };
};

const assertCanReadAppeal = (req, appeal) => {
  if (req.user.role === "ADMIN" || req.user.role === "AUDITOR") {
    return;
  }

  if (appeal.claimantWallet.toLowerCase() === req.user.walletAddress.toLowerCase()) {
    return;
  }

  throw createError("Access denied: appeal does not belong to this wallet", 403);
};

const submitAppeal = async (req, res, next) => {
  try {
    const claimId = normalizeClaimId(req.body.claimId);
    const appealReason = String(req.body.appealReason || "").trim();

    if (!claimId) {
      throw createError("claimId is required", 400);
    }

    if (!appealReason) {
      throw createError("appealReason is required", 400);
    }

    const contract = getReadOnlyContract();
    const claim = await contract.getClaim(claimId);
    const claimantWallet = claim.claimantWallet.toLowerCase();

    if (claimantWallet !== req.user.walletAddress.toLowerCase()) {
      throw createError("Access denied: claim does not belong to this wallet", 403);
    }

    const statusLabel = CLAIM_STATUS[Number(claim.status)] || "UNKNOWN";

    if (statusLabel !== "REJECTED") {
      throw createError("Only rejected claims can be appealed", 400);
    }

    const existingAppeal = await Appeal.findOne({ claimId });

    if (existingAppeal) {
      assertCanReadAppeal(req, existingAppeal);
      return res.status(200).json({
        success: true,
        idempotent: true,
        message: "Appeal was already saved",
        appeal: formatAppeal(existingAppeal),
      });
    }

    const onChainAppealed = await contract.claimAppealed(claimId);

    if (!onChainAppealed) {
      throw createError(
        "Submit the on-chain appeal transaction before saving the appeal record",
        400
      );
    }

    const appealReasonHash = sha256Text(appealReason);
    const providedHash = String(req.body.appealReasonHash || "").trim();
    const appealDeadline = await buildAppealDeadline(contract, claimId);

    if (providedHash && providedHash.toLowerCase() !== appealReasonHash.toLowerCase()) {
      throw createError("appealReasonHash does not match appealReason", 400);
    }

    const appeal = await Appeal.findOneAndUpdate(
      { claimId },
      {
        $setOnInsert: {
          claimId,
          claimantWallet,
          appealReason,
          reasonCategory: String(req.body.reasonCategory || "OTHER").trim().toUpperCase(),
          appealDescription: req.body.appealDescription || appealReason,
          appealReasonHash,
          additionalDocumentHash: req.body.additionalDocumentHash || "",
          additionalDocumentCID: req.body.additionalDocumentCID || "",
          transactionHash: req.body.transactionHash || "",
          appealDeadline,
          history: [
            {
              status: "PENDING",
              actorWallet: req.user.walletAddress,
              actorRole: req.user.role,
              note: "Appeal submitted by claimant",
              timestamp: new Date(),
            },
          ],
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await notifyAdmins({
      actorWallet: claimantWallet,
      type: "APPEAL_SUBMITTED",
      title: `Appeal submitted for claim #${claimId}`,
      message: `The claimant appealed rejected claim #${claimId}.`,
      claimId,
      appealId: appeal._id.toString(),
      link: `/admin/claims/${claimId}`,
      dedupeKey: `appeal:${appeal._id}:submitted`,
    });

    res.status(201).json({
      success: true,
      message: "Appeal submitted successfully",
      appeal: formatAppeal(appeal),
    });
  } catch (error) {
    next(error);
  }
};

const getAppealByClaim = async (req, res, next) => {
  try {
    const claimId = normalizeClaimId(req.params.claimId);
    const appeal = await Appeal.findOne({ claimId });

    if (!appeal) {
      return res.status(404).json({
        success: false,
        message: "Appeal not found for this claim",
      });
    }

    assertCanReadAppeal(req, appeal);

    res.status(200).json({
      success: true,
      appeal: formatAppeal(appeal),
    });
  } catch (error) {
    next(error);
  }
};

const reviewAppeal = async (req, res, next) => {
  let lockedAppealId = null;

  try {
    const {
      status,
      adminNote = "",
      auditorRecommendation = "",
      finalRejectionReason = "",
    } = req.body;
    const normalizedStatus = String(status || "").trim().toUpperCase();

    if (!APPEAL_STATUSES.has(normalizedStatus)) {
      throw createError("Invalid appeal review status", 400);
    }

    const existingAppeal = await Appeal.findById(req.params.id);

    if (!existingAppeal) {
      throw createError("Appeal not found", 404);
    }

    if (
      ["APPROVED", "REJECTED"].includes(existingAppeal.status) &&
      normalizedStatus === existingAppeal.status
    ) {
      return res.status(200).json({
        success: true,
        idempotent: true,
        message: `Appeal was already ${normalizedStatus.toLowerCase()}`,
        transactionHash:
          existingAppeal.reviewTransactionHash || existingAppeal.transactionHash,
        appeal: formatAppeal(existingAppeal),
      });
    }

    if (
      ["APPROVED", "REJECTED"].includes(existingAppeal.status) &&
      normalizedStatus !== existingAppeal.status
    ) {
      throw createError("Finalized appeal decisions cannot be changed", 409);
    }

    const isFinalDecision = ["APPROVED", "REJECTED"].includes(normalizedStatus);

    if (!isFinalDecision) {
      const appeal = await Appeal.findByIdAndUpdate(
        req.params.id,
        {
          $set: {
            status: normalizedStatus,
            adminNote,
            auditorRecommendation,
            reviewedAt: new Date(),
          },
          $push: {
            history: {
              status: normalizedStatus,
              actorWallet: req.user.walletAddress,
              actorRole: req.user.role,
              note: adminNote,
              timestamp: new Date(),
            },
          },
        },
        { new: true, runValidators: true }
      );

      return res.status(200).json({
        success: true,
        message: "Appeal review updated successfully",
        transactionHash: "",
        appeal: formatAppeal(appeal),
      });
    }

    const now = new Date();
    const lockedAppeal = await Appeal.findOneAndUpdate(
      {
        _id: req.params.id,
        status: { $nin: ["APPROVED", "REJECTED"] },
        $or: [
          { reviewOperationStatus: { $ne: "PROCESSING" } },
          { reviewLockExpiresAt: { $lte: now } },
        ],
      },
      {
        $set: {
          reviewOperationStatus: "PROCESSING",
          reviewDesiredStatus: normalizedStatus,
          reviewLockExpiresAt: new Date(Date.now() + 2 * 60 * 1000),
          reviewFailureReason: "",
        },
      },
      { new: true }
    );

    if (!lockedAppeal) {
      throw createError("Another appeal decision is currently processing", 409);
    }

    lockedAppealId = lockedAppeal._id;
    let transactionHash = "";
    let reopenedClaim = null;
    const contract = getReadOnlyContract();
    const onChainClaim = await contract.getClaim(lockedAppeal.claimId);
    const appealFinalized = await contract.claimAppealFinalized(
      lockedAppeal.claimId
    );
    transactionHash =
      String(req.body.transactionHash || "").trim() ||
      lockedAppeal.reviewTransactionHash;

    if (!appealFinalized) {
      throw createError(
        "Submit the on-chain appeal decision with the admin browser wallet first",
        409
      );
    }

    if (!/^0x[a-f\d]{64}$/i.test(transactionHash)) {
      throw createError("A valid appeal decision transactionHash is required", 400);
    }

    const [receipt, transaction] = await Promise.all([
      contract.runner.getTransactionReceipt(transactionHash),
      contract.runner.getTransaction(transactionHash),
    ]);

    if (!receipt || !transaction || Number(receipt.status) !== 1) {
      throw createError("Appeal decision transaction is not confirmed", 409);
    }

    if (
      transaction.to?.toLowerCase() !== String(contract.target).toLowerCase() ||
      transaction.from.toLowerCase() !== req.user.walletAddress.toLowerCase()
    ) {
      throw createError(
        "Appeal decision transaction signer does not match this admin",
        403
      );
    }

    let decisionEventMatched = false;

    for (const log of receipt.logs) {
      try {
        const parsedLog = contract.interface.parseLog(log);
        const reopened = normalizedStatus === "APPROVED";

        if (
          parsedLog?.name === "ClaimAppealFinalized" &&
          parsedLog.args.claimId.toString() === lockedAppeal.claimId &&
          Boolean(parsedLog.args.reopened) === reopened
        ) {
          decisionEventMatched = true;
          break;
        }
      } catch {
        // Ignore unrelated logs.
      }
    }

    if (!decisionEventMatched) {
      throw createError(
        "Transaction does not contain the requested appeal decision",
        409
      );
    }

    if (normalizedStatus === "APPROVED") {
      reopenedClaim = onChainClaim;
    }

    const appeal = await Appeal.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          status: normalizedStatus,
          adminNote,
          auditorRecommendation,
          finalRejectionReason:
            normalizedStatus === "REJECTED"
              ? finalRejectionReason || adminNote
              : existingAppeal.finalRejectionReason,
          reviewedAt: new Date(),
          reviewOperationStatus: "COMPLETED",
          reviewTransactionHash:
            transactionHash || lockedAppeal.reviewTransactionHash,
          reviewLockExpiresAt: null,
          reviewFailureReason: "",
        },
        $push: {
          history: {
            status: normalizedStatus,
            actorWallet: req.user.walletAddress,
            actorRole: req.user.role,
            note: adminNote,
            timestamp: new Date(),
          },
        },
      },
      { new: true, runValidators: true }
    );

    const displayStatus = normalizedStatus.replaceAll("_", " ");
    const appealMessage =
      normalizedStatus === "APPROVED"
        ? `Your appeal for claim #${appeal.claimId} was approved. The claim was reopened for a fresh oracle verification cycle.`
        : `Your appeal for claim #${appeal.claimId} is now ${displayStatus}.`;

    await notifyWallet(appeal.claimantWallet, {
      actorWallet: req.user.walletAddress,
      type: "APPEAL_STATUS_CHANGED",
      title: `Appeal for claim #${appeal.claimId}: ${displayStatus}`,
      message: appealMessage,
      claimId: appeal.claimId,
      appealId: appeal._id.toString(),
      status: normalizedStatus,
      link: `/user/claims/${appeal.claimId}`,
      dedupeKey: `appeal:${appeal._id}:review:${normalizedStatus}`,
    });

    res.status(200).json({
      success: true,
      message:
        normalizedStatus === "APPROVED"
          ? "Appeal approved and claim reopened successfully"
          : "Appeal review updated successfully",
      transactionHash,
      reopenedClaimStatus: reopenedClaim
        ? CLAIM_STATUS[Number(reopenedClaim.status)] || "UNKNOWN"
        : null,
      appeal: formatAppeal(appeal),
    });
  } catch (error) {
    if (lockedAppealId) {
      await Appeal.findByIdAndUpdate(lockedAppealId, {
        $set: {
          reviewOperationStatus: "FAILED",
          reviewLockExpiresAt: null,
          reviewFailureReason: error.message,
        },
      }).catch(() => {});
    }

    next(error);
  }
};

module.exports = {
  submitAppeal,
  getAppealByClaim,
  reviewAppeal,
};
