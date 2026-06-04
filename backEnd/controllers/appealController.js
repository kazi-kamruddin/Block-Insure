const crypto = require("crypto");
const Appeal = require("../models/Appeal");
const {
  getAdminContract,
  getReadOnlyContract,
} = require("../services/contractService");
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

const formatAppeal = (appeal) => {
  if (!appeal) return null;

  return {
    id: appeal._id,
    claimId: appeal.claimId,
    claimantWallet: appeal.claimantWallet,
    appealReason: appeal.appealReason,
    appealReasonHash: appeal.appealReasonHash,
    additionalDocumentHash: appeal.additionalDocumentHash,
    additionalDocumentCID: appeal.additionalDocumentCID,
    status: appeal.status,
    adminNote: appeal.adminNote,
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
      throw createError("An appeal already exists for this claim", 409);
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

    if (providedHash && providedHash.toLowerCase() !== appealReasonHash.toLowerCase()) {
      throw createError("appealReasonHash does not match appealReason", 400);
    }

    const appeal = await Appeal.create({
      claimId,
      claimantWallet,
      appealReason,
      appealReasonHash,
      additionalDocumentHash: req.body.additionalDocumentHash || "",
      additionalDocumentCID: req.body.additionalDocumentCID || "",
      transactionHash: req.body.transactionHash || "",
    });

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
  try {
    const { status, adminNote = "" } = req.body;
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
      normalizedStatus !== existingAppeal.status
    ) {
      throw createError("Finalized appeal decisions cannot be changed", 409);
    }

    let transactionHash = "";
    let reopenedClaim = null;

    if (normalizedStatus === "APPROVED" && existingAppeal.status !== "APPROVED") {
      const contract = getAdminContract();
      const tx = await contract.reopenClaimAfterAppeal(existingAppeal.claimId);

      await tx.wait();

      transactionHash = tx.hash;
      reopenedClaim = await contract.getClaim(existingAppeal.claimId);
    }

    if (normalizedStatus === "REJECTED" && existingAppeal.status !== "REJECTED") {
      const contract = getAdminContract();
      const tx = await contract.finalizeRejectedAppeal(existingAppeal.claimId);

      await tx.wait();

      transactionHash = tx.hash;
    }

    const appeal = await Appeal.findByIdAndUpdate(
      req.params.id,
      {
        status: normalizedStatus,
        adminNote,
        reviewedAt: new Date(),
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
    next(error);
  }
};

module.exports = {
  submitAppeal,
  getAppealByClaim,
  reviewAppeal,
};
