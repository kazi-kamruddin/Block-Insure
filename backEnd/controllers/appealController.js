const crypto = require("crypto");
const Appeal = require("../models/Appeal");
const {
  getClaimAdjudicator,
  getReadOnlyContract,
} = require("../services/contractService");
const { notifyAdmins } = require("../services/notificationService");

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const sha256Text = (value) =>
  `0x${crypto.createHash("sha256").update(value, "utf8").digest("hex")}`;

const formatAppeal = (appeal) =>
  appeal
    ? {
        id: appeal._id,
        claimId: appeal.claimId,
        claimantWallet: appeal.claimantWallet,
        appealReason: appeal.appealReason,
        reasonCategory: appeal.reasonCategory,
        appealDescription: appeal.appealDescription,
        appealReasonHash: appeal.appealReasonHash,
        additionalDocumentHash: appeal.additionalDocumentHash,
        additionalDocumentCID: appeal.additionalDocumentCID,
        proposedCorrections: {
          hospitalId: appeal.proposedHospitalId || "",
          invoiceNumber: appeal.proposedInvoiceNumber || "",
          claimType: appeal.proposedClaimType || "",
          claimAmountEth: appeal.proposedClaimAmountEth || "",
        },
        status: appeal.status,
        history: appeal.history || [],
        transactionHash: appeal.transactionHash,
        submittedAt: appeal.submittedAt,
        updatedAt: appeal.updatedAt,
      }
    : null;

const assertCanReadAppeal = (req, appeal) => {
  if (["ADMIN", "AUDITOR"].includes(req.user.role)) return;
  if (
    appeal.claimantWallet.toLowerCase() === req.user.walletAddress.toLowerCase()
  ) return;
  throw createError("Access denied: appeal does not belong to this wallet", 403);
};

const verifyAppealTransaction = async (contract, claimId, walletAddress, txHash) => {
  if (!/^0x[a-f\d]{64}$/i.test(txHash)) {
    throw createError("A confirmed appeal transactionHash is required", 400);
  }
  const [receipt, transaction] = await Promise.all([
    contract.runner.getTransactionReceipt(txHash),
    contract.runner.getTransaction(txHash),
  ]);
  if (!receipt || !transaction || Number(receipt.status) !== 1) {
    throw createError("Appeal transaction is not confirmed", 409);
  }
  if (
    transaction.to?.toLowerCase() !== String(contract.target).toLowerCase() ||
    transaction.from.toLowerCase() !== walletAddress.toLowerCase()
  ) {
    throw createError("Appeal transaction signer or destination is invalid", 403);
  }
  const matched = receipt.logs.some((log) => {
    try {
      const parsed = contract.interface.parseLog(log);
      return parsed?.name === "ClaimAppealed" && parsed.args.claimId.toString() === claimId;
    } catch {
      return false;
    }
  });
  if (!matched) throw createError("Transaction does not contain this claim appeal", 409);
};

const submitAppeal = async (req, res, next) => {
  try {
    const claimId = String(req.body.claimId || "").trim();
    const appealReason = String(req.body.appealReason || "").trim();
    if (!claimId || !appealReason) {
      throw createError("claimId and appealReason are required", 400);
    }

    const contract = getReadOnlyContract();
    const adjudicator = await getClaimAdjudicator(contract);
    const claim = await contract.getClaim(claimId);
    if (claim.claimantWallet.toLowerCase() !== req.user.walletAddress.toLowerCase()) {
      throw createError("Access denied: claim does not belong to this wallet", 403);
    }

    const round = await adjudicator.appealRound(claimId);
    if (Number(round) === 0) {
      throw createError("Submit the on-chain appeal before saving its metadata", 400);
    }
    await verifyAppealTransaction(
      contract,
      claimId,
      req.user.walletAddress,
      String(req.body.transactionHash || "").trim()
    );

    const appealReasonHash = sha256Text(appealReason);
    const providedHash = String(req.body.appealReasonHash || "").trim();
    if (providedHash && providedHash.toLowerCase() !== appealReasonHash.toLowerCase()) {
      throw createError("appealReasonHash does not match appealReason", 400);
    }

    const appeal = await Appeal.findOneAndUpdate(
      { claimId },
      {
        $setOnInsert: {
          claimId,
          claimantWallet: claim.claimantWallet.toLowerCase(),
          appealReason,
          reasonCategory: String(req.body.reasonCategory || "OTHER").toUpperCase(),
          appealDescription: req.body.appealDescription || appealReason,
          appealReasonHash,
          additionalDocumentHash: req.body.additionalDocumentHash || "",
          additionalDocumentCID: req.body.additionalDocumentCID || "",
          proposedHospitalId: String(req.body.proposedHospitalId || "").trim(),
          proposedInvoiceNumber: String(req.body.proposedInvoiceNumber || "").trim(),
          proposedClaimType: String(req.body.proposedClaimType || "").trim().toUpperCase(),
          proposedClaimAmountEth: String(req.body.proposedClaimAmountEth || "").trim(),
          transactionHash: req.body.transactionHash,
          status: "UNDER_REVIEW",
          history: [{
            status: "UNDER_REVIEW",
            actorWallet: req.user.walletAddress,
            actorRole: req.user.role,
            note: `Appeal round ${round} automatically opened a new oracle cycle`,
            timestamp: new Date(),
          }],
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await notifyAdmins({
      actorWallet: claim.claimantWallet,
      type: "APPEAL_SUBMITTED",
      title: `Appeal submitted for claim #${claimId}`,
      message: `Appeal round ${round} automatically opened a new oracle cycle.`,
      claimId,
      appealId: appeal._id.toString(),
      link: `/admin/claims/${claimId}`,
      dedupeKey: `appeal:${appeal._id}:submitted`,
    });
    res.status(201).json({ success: true, appeal: formatAppeal(appeal) });
  } catch (error) {
    next(error);
  }
};

const getAppealByClaim = async (req, res, next) => {
  try {
    const claimId = String(req.params.claimId || "").trim();
    let appeal = await Appeal.findOne({ claimId });
    if (!appeal) throw createError("Appeal not found for this claim", 404);
    assertCanReadAppeal(req, appeal);

    const contract = getReadOnlyContract();
    const adjudicator = await getClaimAdjudicator(contract);
    const [version, finalized] = await Promise.all([
      contract.claimVersion(claimId),
      adjudicator.appealFinalized(claimId),
    ]);
    if (finalized && !["APPROVED", "REJECTED"].includes(appeal.status)) {
      const decision = await adjudicator.getDecision(claimId, version);
      const status = decision.approved ? "APPROVED" : "REJECTED";
      appeal = await Appeal.findByIdAndUpdate(
        appeal._id,
        {
          $set: { status, reviewedAt: new Date() },
          $push: {
            history: {
              status,
              actorWallet: String(adjudicator.target),
              actorRole: "PROTOCOL",
              note: "Appeal finalized automatically by oracle/auditor adjudication",
              timestamp: new Date(),
            },
          },
        },
        { new: true }
      );
    }
    res.status(200).json({ success: true, appeal: formatAppeal(appeal) });
  } catch (error) {
    next(error);
  }
};

module.exports = { submitAppeal, getAppealByClaim };
