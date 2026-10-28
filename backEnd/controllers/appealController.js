const Appeal = require("../models/Appeal");
const File = require("../models/File");
const { assertEvidenceDeployment, sealBundle, getBundle } = require("../services/evidenceBundleService");
const { assertAppealFactsMatch } = require("../services/appealFactService");
const {
  getClaimAdjudicator,
  getReadOnlyContract,
} = require("../services/contractService");
const { notifyAdmins } = require("../services/notificationService");
const {
  buildAppealCommitmentPayload,
  hashAppealCommitment,
} = require("../services/appealCommitmentService");

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const formatAppeal = (appeal) =>
  appeal
    ? {
        id: appeal._id,
        claimId: appeal.claimId,
        claimVersion: appeal.claimVersion,
        appealRound: appeal.appealRound,
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

const assertCanReadAppeal = async (req, appeal) => {
  if (req.user.role === "ADMIN") return;
  if (
    appeal.claimantWallet.toLowerCase() === req.user.walletAddress.toLowerCase()
  ) return;
  if (req.user.role === "AUDITOR") {
    const contract = getReadOnlyContract();
    const version = await contract.claimVersion(appeal.claimId);
    const adjudicator = await getClaimAdjudicator(contract);
    if (Number(version) === appeal.claimVersion && await adjudicator.isAssigned(appeal.claimId, version, req.user.walletAddress)) return;
  }
  throw createError("Access denied: appeal does not belong to this wallet", 403);
};

const verifyAppealTransaction = async (
  contract,
  claimId,
  walletAddress,
  txHash,
  appealReasonHash
) => {
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
      return (
        log.address.toLowerCase() === String(contract.target).toLowerCase() &&
        parsed?.name === "ClaimAppealed" &&
        parsed.args.claimId.toString() === claimId &&
        String(parsed.args.appealReasonHash).toLowerCase() ===
          appealReasonHash.toLowerCase()
      );
    } catch {
      return false;
    }
  });
  if (!matched) throw createError("Transaction does not contain this claim appeal", 409);
  const adjudicator = await getClaimAdjudicator(contract);
  for (const log of receipt.logs) {
    try {
      if (log.address.toLowerCase() !== String(adjudicator.target).toLowerCase()) continue;
      const event = adjudicator.interface.parseLog(log);
      if (event?.name === "AppealStarted" && String(event.args.claimId) === claimId) {
        return { claimVersion: Number(event.args.newClaimVersion), appealRound: Number(event.args.appealRound), blockNumber: receipt.blockNumber };
      }
    } catch { /* unrelated event */ }
  }
  throw createError("Version-bound appeal event is unavailable", 409);
};

const registerConfirmedAppeal = async (payload, user) => {
    const claimId = String(payload.claimId || "").trim();
    const appealReason = String(payload.appealReason || "").trim();
    if (!claimId || !appealReason) {
      throw createError("claimId and appealReason are required", 400);
    }

    const contract = getReadOnlyContract();
    const adjudicator = await getClaimAdjudicator(contract);
    const claim = await contract.getClaim(claimId);
    if (claim.claimantWallet.toLowerCase() !== user.walletAddress.toLowerCase()) {
      throw createError("Access denied: claim does not belong to this wallet", 403);
    }

    const commitmentPayload = buildAppealCommitmentPayload({
      ...payload,
      claimId,
      appealReason,
    });
    const appealReasonHash = hashAppealCommitment(commitmentPayload);
    const providedHash = String(payload.appealReasonHash || "").trim();
    if (providedHash.toLowerCase() !== appealReasonHash.toLowerCase()) {
      throw createError("appealReasonHash does not match the committed appeal payload", 400);
    }

    const verified = await verifyAppealTransaction(
      contract,
      claimId,
      user.walletAddress,
      String(payload.transactionHash || "").trim(),
      appealReasonHash
    );
    const round = verified.appealRound;
    const historicalClaim = await contract.getClaim(claimId, { blockTag: verified.blockNumber });
    assertAppealFactsMatch(historicalClaim, commitmentPayload);
    const deploymentScope = await assertEvidenceDeployment();

    const appeal = await Appeal.findOneAndUpdate(
      { deploymentScope, claimId, claimVersion: verified.claimVersion },
      {
        $setOnInsert: {
          claimId,
          deploymentScope,
          claimVersion: verified.claimVersion,
          appealRound: round,
          claimantWallet: claim.claimantWallet.toLowerCase(),
          appealReason,
          reasonCategory: commitmentPayload.reasonCategory,
          appealDescription: commitmentPayload.appealDescription,
          appealReasonHash,
          additionalDocumentHash: commitmentPayload.additionalDocumentHash,
          additionalDocumentCID: commitmentPayload.additionalDocumentCID,
          proposedHospitalId: commitmentPayload.proposedHospitalId,
          proposedInvoiceNumber: commitmentPayload.proposedInvoiceNumber,
          proposedClaimType: commitmentPayload.proposedClaimType,
          proposedClaimAmountEth: commitmentPayload.proposedClaimAmountEth,
          transactionHash: payload.transactionHash,
          status: "UNDER_REVIEW",
          history: [{
            status: "UNDER_REVIEW",
            actorWallet: user.walletAddress,
            actorRole: user.role,
            note: `Appeal/recovery round ${round} opened claim version ${verified.claimVersion} for automatic registry verification`,
            timestamp: new Date(),
          }],
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );
    if (appeal.appealReasonHash !== appealReasonHash || appeal.transactionHash !== payload.transactionHash) throw createError("This claim version already has another registered appeal", 409);
    const previousBundle = await getBundle(claimId, verified.claimVersion - 1);
    if (!previousBundle) throw createError("Recover the previous claim evidence set before registering this appeal", 409);
    const documents = [];
    for (const id of previousBundle.documentIds) {
      const file = await File.findById(id);
      if (!file) throw createError("Original evidence is unavailable", 409);
      documents.push(file);
    }
    if (commitmentPayload.additionalDocumentHash) {
      const file = await File.findOne({ claimId, claimVersion: verified.claimVersion, uploaderWallet: user.walletAddress,
        sha256Hash: commitmentPayload.additionalDocumentHash.replace(/^0x/, ""), ipfsCID: commitmentPayload.additionalDocumentCID });
      if (!file) throw createError("Appeal evidence does not match an owned version-bound upload", 409);
      await require("../services/evidenceChainService").assignEvidenceChainLink(file, claimId);
      const event = await require("../services/evidenceTransparencyService").appendEvidenceEvent({
        idempotencyKey: `evidence-added:${file._id}:${verified.claimVersion}`, eventType: "EVIDENCE_ADDED", claimId,
        claimVersion: verified.claimVersion, documentId: file._id, actorWallet: user.walletAddress,
        ciphertextHash: file.sha256Hash, ciphertextReference: file.ipfsCID, associatedDataHash: file.associatedDataHash,
        encryptionSchemeVersion: file.encryptionSchemeVersion,
      });
      file.evidenceEventIndex = event.treeIndex;
      await file.save();
      if (!documents.some((document) => String(document._id) === String(file._id))) documents.push(file);
    }
    await sealBundle({ claimId, claimVersion: verified.claimVersion, ownerWallet: user.walletAddress, documents });

    await notifyAdmins({
      actorWallet: claim.claimantWallet,
      type: "APPEAL_SUBMITTED",
      title: `Appeal submitted for claim #${claimId}`,
      message: `Claim version ${verified.claimVersion} is ready for the new automatic Oracle cycle.`,
      claimId,
      appealId: appeal._id.toString(),
      link: `/admin/claims/${claimId}`,
      dedupeKey: `appeal:${appeal._id}:submitted`,
    });
    return { success: true, appeal: formatAppeal(appeal) };
};

const submitAppeal = async (req, res, next) => {
  try { res.status(201).json(await registerConfirmedAppeal(req.body, req.user)); }
  catch (error) { next(error); }
};

const getAppealByClaim = async (req, res, next) => {
  try {
    const claimId = String(req.params.claimId || "").trim();
    let appeal = await Appeal.findOne({ deploymentScope: await assertEvidenceDeployment(), claimId }).sort({ claimVersion: -1 });
    if (!appeal) throw createError("Appeal not found for this claim", 404);
    await assertCanReadAppeal(req, appeal);

    const contract = getReadOnlyContract();
    const adjudicator = await getClaimAdjudicator(contract);
    const [version, finalized] = await Promise.all([
      contract.claimVersion(claimId),
      adjudicator.appealFinalized(claimId),
    ]);
    if (finalized && Number(version) === appeal.claimVersion && !["APPROVED", "REJECTED"].includes(appeal.status)) {
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
        { returnDocument: "after" }
      );
    }
    res.status(200).json({ success: true, appeal: formatAppeal(appeal) });
  } catch (error) {
    next(error);
  }
};

module.exports = { submitAppeal, getAppealByClaim, verifyAppealTransaction, registerConfirmedAppeal };
