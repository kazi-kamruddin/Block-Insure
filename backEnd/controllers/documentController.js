const File = require("../models/File");
const {
  assignEvidenceChainLink,
  normalizeClaimId,
} = require("../services/evidenceChainService");
const {
  getClaimAdjudicator,
  getReadOnlyContract,
} = require("../services/contractService");
const { calculateSHA256 } = require("../services/hashService");
const { unpinFromPinata, uploadToPinata } = require("../services/ipfsService");
const { notifyAdmins } = require("../services/notificationService");
const ClaimSubmissionAttempt = require("../models/ClaimSubmissionAttempt");
const EvidenceAccessLog = require("../models/EvidenceAccessLog");
const {
  getEvidenceKeyMaterial,
  unwrapEvidenceKey,
} = require("../services/evidenceKeyService");

const formatDocumentRecord = (fileRecord) => ({
  id: fileRecord._id,
  claimId: fileRecord.claimId,
  uploaderWallet: fileRecord.uploaderWallet,
  originalName: fileRecord.originalName,
  mimeType: fileRecord.mimeType,
  sha256Hash: fileRecord.sha256Hash,
  ipfsCID: fileRecord.ipfsCID,
  documentType: fileRecord.documentType,
  encrypted: Boolean(fileRecord.encrypted),
  encryptionAlgorithm: fileRecord.encryptionAlgorithm || "",
  originalMimeType: fileRecord.originalMimeType || "",
  keyProvider: fileRecord.keyProvider || "",
  keyId: fileRecord.keyId || "",
  recoverableAcrossBrowsers: Boolean(fileRecord.keyId),
  previousEvidenceHash: fileRecord.previousEvidenceHash,
  evidenceChainHash: fileRecord.evidenceChainHash,
  evidenceChainIndex: fileRecord.evidenceChainIndex,
  uploadedAt: fileRecord.createdAt,
});

const isAssignedReviewer = async (fileRecord, user) => {
  if (user.role === "ADMIN") return true;
  if (user.role !== "AUDITOR" || !fileRecord.claimId) return false;
  const contract = getReadOnlyContract();
  const adjudicator = await getClaimAdjudicator(contract);
  const version = await contract.claimVersion(fileRecord.claimId);
  return adjudicator.isAssigned(fileRecord.claimId, version, user.walletAddress);
};

const getEncryptionPublicKey = async (_req, res, next) => {
  try {
    const { publicKeyPem, keyId } = getEvidenceKeyMaterial();

    res.status(200).json({
      success: true,
      key: {
        keyId,
        algorithm: "RSA-OAEP-3072-SHA256",
        publicKeyPem,
      },
    });
  } catch (error) {
    next(error);
  }
};

const assertClaimBelongsToWallet = async (claimId, walletAddress) => {
  if (!claimId) return null;

  const contract = getReadOnlyContract();
  const claim = await contract.getClaim(claimId);

  if (claim.claimantWallet.toLowerCase() !== walletAddress.toLowerCase()) {
    const error = new Error("Access denied: claim does not belong to this wallet");
    error.statusCode = 403;
    throw error;
  }

  return claim;
};

const uploadDocument = async (req, res, next) => {
  let activeAttempt = null;
  let createdFileRecord = null;
  let uploadedCid = "";

  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Document file is required",
      });
    }

    const { documentType = "CLAIM_DOCUMENT" } = req.body;
    const claimId = normalizeClaimId(req.body.claimId);
    const attemptId = String(req.body.attemptId || "").trim();
    const encrypted = String(req.body.encrypted || "").toLowerCase() === "true";
    const encryptionAlgorithm = String(req.body.encryptionAlgorithm || "").trim();
    const originalMimeType = String(req.body.originalMimeType || "").trim();
    const originalName = String(req.body.originalName || "").trim();
    const wrappedEvidenceKey = String(req.body.wrappedEvidenceKey || "").trim();
    const keyId = String(req.body.keyId || "").trim();

    if (!encrypted || req.file.mimetype !== "application/octet-stream") {
      return res.status(400).json({
        success: false,
        message: "Evidence must be encrypted in the browser before upload",
      });
    }

    if (req.file.buffer.subarray(0, 8).toString("utf8") !== "BINSENC1") {
      return res.status(400).json({
        success: false,
        message: "Encrypted evidence header is invalid",
      });
    }

    if (encrypted && encryptionAlgorithm !== "AES-256-GCM") {
      return res.status(400).json({
        success: false,
        message: "Encrypted evidence must use AES-256-GCM",
      });
    }

    const activeKey = getEvidenceKeyMaterial();

    if (!wrappedEvidenceKey || !keyId || keyId !== activeKey.keyId) {
      return res.status(400).json({
        success: false,
        message:
          "Evidence must include an AES key wrapped by the active application RSA key",
      });
    }

    if (!attemptId && !claimId) {
      return res.status(400).json({
        success: false,
        message:
          "A claim submission attempt or an existing owned claim is required before upload",
      });
    }

    let attempt = null;

    if (attemptId) {
      if (!/^[a-f\d]{24}$/i.test(attemptId)) {
        return res.status(400).json({
          success: false,
          message: "Claim submission attempt id is invalid",
        });
      }

      attempt = await ClaimSubmissionAttempt.findOneAndUpdate({
        _id: attemptId,
        walletAddress: req.user.walletAddress,
        expiresAt: { $gt: new Date() },
        status: "AUTHORIZED",
      }, {
        $set: { status: "UPLOADING", failureReason: "" },
      }, { new: true });

      if (!attempt) {
        const existingAttempt = await ClaimSubmissionAttempt.findOne({
          _id: attemptId,
          walletAddress: req.user.walletAddress,
        });

        if (existingAttempt?.status === "UPLOADED" && existingAttempt.documentId) {
          const existingDocument = await File.findById(existingAttempt.documentId);

          if (existingDocument) {
            return res.status(200).json({
              success: true,
              idempotent: true,
              message: "Evidence was already uploaded for this attempt",
              document: formatDocumentRecord(existingDocument),
            });
          }
        }

        return res.status(409).json({
          success: false,
          message: existingAttempt
            ? `Claim submission attempt is already ${existingAttempt.status.toLowerCase()}`
            : "Claim submission attempt was not found or has expired",
        });
      }

      activeAttempt = attempt;
    }

    await assertClaimBelongsToWallet(claimId, req.user.walletAddress);

    const sha256Hash = calculateSHA256(req.file.buffer);

    const ipfsCID = await uploadToPinata(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );
    uploadedCid = ipfsCID;

    let fileRecord = await File.create({
      claimId,
      uploaderWallet: req.user.walletAddress,
      originalName: originalName || req.file.originalname.replace(/\.binsenc$/i, ""),
      mimeType: req.file.mimetype,
      sha256Hash,
      ipfsCID,
      documentType,
      encrypted,
      encryptionAlgorithm: encrypted ? encryptionAlgorithm : "",
      originalMimeType: encrypted ? originalMimeType : req.file.mimetype,
      keyProvider: "LOCAL_RSA",
      keyId,
      wrappedEvidenceKey,
    });
    createdFileRecord = fileRecord;

    fileRecord = await assignEvidenceChainLink(fileRecord, claimId);

    if (attempt) {
      await ClaimSubmissionAttempt.updateOne(
        { _id: attempt._id, status: "UPLOADING" },
        {
          $set: {
            documentId: fileRecord._id.toString(),
            status: "UPLOADED",
          },
        }
      );
    }

    res.status(201).json({
      success: true,
      message: "Document uploaded successfully",
      document: formatDocumentRecord(fileRecord),
    });
  } catch (error) {
    next(error);
  }
};

const verifyDocument = async (req, res, next) => {
  try {
    const fileRecord = await File.findById(req.params.id);

    if (!fileRecord) {
      return res.status(404).json({
        success: false,
        message: "Document record not found",
      });
    }

    const isOwner =
      fileRecord.uploaderWallet.toLowerCase() === req.user.walletAddress.toLowerCase();
    const canAudit = await isAssignedReviewer(fileRecord, req.user);

    if (!isOwner && !canAudit) {
      return res.status(403).json({
        success: false,
        message: "Access denied: document does not belong to this wallet",
      });
    }

    res.status(200).json({
      success: true,
      document: formatDocumentRecord(fileRecord),
    });
  } catch (error) {
    next(error);
  }
};

const getDecryptionKey = async (req, res, next) => {
  try {
    const fileRecord = await File.findById(req.params.id).select(
      "+wrappedEvidenceKey"
    );

    if (!fileRecord) {
      return res.status(404).json({
        success: false,
        message: "Document record not found",
      });
    }

    const isOwner =
      fileRecord.uploaderWallet.toLowerCase() ===
      req.user.walletAddress.toLowerCase();
    const isAuthorizedReviewer = await isAssignedReviewer(fileRecord, req.user);

    if (!isOwner && !isAuthorizedReviewer) {
      return res.status(403).json({
        success: false,
        message: "This wallet is not authorized to decrypt this evidence",
      });
    }

    if (!fileRecord.wrappedEvidenceKey || !fileRecord.keyId) {
      return res.status(409).json({
        success: false,
        message:
          "This legacy document has a browser-only key and cannot be recovered by the application",
      });
    }

    const rawKey = unwrapEvidenceKey(
      fileRecord.wrappedEvidenceKey,
      fileRecord.keyId
    );

    await EvidenceAccessLog.create({
      documentId: fileRecord._id,
      claimId: fileRecord.claimId,
      actorWallet: req.user.walletAddress,
      actorRole: req.user.role,
      action: "UNWRAP_KEY",
      userAgent: req.get("user-agent") || "",
    });

    res.status(200).json({
      success: true,
      decryption: {
        algorithm: fileRecord.encryptionAlgorithm,
        keyBase64: rawKey.toString("base64"),
        keyId: fileRecord.keyId,
        encryptedSha256Hash: fileRecord.sha256Hash,
        originalName: fileRecord.originalName,
        originalMimeType:
          fileRecord.originalMimeType || "application/octet-stream",
      },
    });
  } catch (error) {
    next(error);
  }
};

const attachClaimIdToDocument = async (req, res, next) => {
  try {
    const fileRecord = await File.findById(req.params.id);

    if (!fileRecord) {
      return res.status(404).json({
        success: false,
        message: "Document record not found",
      });
    }

    const isOwner =
      fileRecord.uploaderWallet.toLowerCase() === req.user.walletAddress.toLowerCase();

    if (!isOwner) {
      return res.status(403).json({
        success: false,
        message: "Access denied: document does not belong to this wallet",
      });
    }

    const claimId = normalizeClaimId(req.body.claimId);

    if (!claimId) {
      return res.status(400).json({
        success: false,
        message: "claimId is required",
      });
    }

    if (fileRecord.claimId && fileRecord.claimId !== claimId) {
      return res.status(409).json({
        success: false,
        message: "Document is already linked to another claim",
      });
    }

    const attemptId = String(req.body.attemptId || "").trim();

    if (!/^[a-f\d]{24}$/i.test(attemptId)) {
      return res.status(400).json({
        success: false,
        message: "A valid claim submission attempt is required",
      });
    }

    const attempt = await ClaimSubmissionAttempt.findOne(
      {
        _id: attemptId,
        walletAddress: req.user.walletAddress,
        documentId: fileRecord._id.toString(),
        status: { $in: ["UPLOADED", "TX_SUBMITTED", "COMPLETED"] },
      }
    );

    if (!attempt) {
      return res.status(409).json({
        success: false,
        message: "Document is not bound to this authorized claim attempt",
      });
    }

    const claim = await assertClaimBelongsToWallet(
      claimId,
      req.user.walletAddress
    );

    if (attempt.policyId !== claim.policyId.toString()) {
      return res.status(409).json({
        success: false,
        message: "Claim policy does not match the authorized attempt",
      });
    }

    const linkedDocument = await assignEvidenceChainLink(fileRecord, claimId);

    const completedAttempt = await ClaimSubmissionAttempt.findOneAndUpdate(
      { _id: attempt._id },
      {
        $set: {
          claimId,
          status: "COMPLETED",
          completedAt: new Date(),
        },
      },
      { new: true }
    );

    if (!completedAttempt) {
      return res.status(409).json({
        success: false,
        message: "Document is not bound to this authorized claim attempt",
      });
    }

    await notifyAdmins({
      actorWallet: req.user.walletAddress,
      type: "CLAIM_SUBMITTED",
      title: `New claim #${claimId} submitted`,
      message: `A new claim was submitted by ${req.user.walletAddress}.`,
      claimId,
      link: `/admin/claims/${claimId}`,
      dedupeKey: `claim:${claimId}:submitted`,
    });

    res.status(200).json({
      success: true,
      message: "Document linked to claim successfully",
      document: formatDocumentRecord(linkedDocument),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getEncryptionPublicKey,
  getDecryptionKey,
  uploadDocument,
  verifyDocument,
  attachClaimIdToDocument,
};
