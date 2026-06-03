const File = require("../models/File");
const {
  assignEvidenceChainLink,
  normalizeClaimId,
} = require("../services/evidenceChainService");
const { getReadOnlyContract } = require("../services/contractService");
const { calculateSHA256 } = require("../services/hashService");
const { uploadToPinata } = require("../services/ipfsService");

const formatDocumentRecord = (fileRecord) => ({
  id: fileRecord._id,
  claimId: fileRecord.claimId,
  uploaderWallet: fileRecord.uploaderWallet,
  originalName: fileRecord.originalName,
  mimeType: fileRecord.mimeType,
  sha256Hash: fileRecord.sha256Hash,
  ipfsCID: fileRecord.ipfsCID,
  documentType: fileRecord.documentType,
  previousEvidenceHash: fileRecord.previousEvidenceHash,
  evidenceChainHash: fileRecord.evidenceChainHash,
  evidenceChainIndex: fileRecord.evidenceChainIndex,
  uploadedAt: fileRecord.createdAt,
});

const assertClaimBelongsToWallet = async (claimId, walletAddress) => {
  if (!claimId) return;

  const contract = getReadOnlyContract();
  const claim = await contract.getClaim(claimId);

  if (claim.claimantWallet.toLowerCase() !== walletAddress.toLowerCase()) {
    const error = new Error("Access denied: claim does not belong to this wallet");
    error.statusCode = 403;
    throw error;
  }
};

const uploadDocument = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Document file is required",
      });
    }

    const { documentType = "CLAIM_DOCUMENT" } = req.body;
    const claimId = normalizeClaimId(req.body.claimId);

    await assertClaimBelongsToWallet(claimId, req.user.walletAddress);

    const sha256Hash = calculateSHA256(req.file.buffer);

    const ipfsCID = await uploadToPinata(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    let fileRecord = await File.create({
      claimId,
      uploaderWallet: req.user.walletAddress,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sha256Hash,
      ipfsCID,
      documentType,
    });

    fileRecord = await assignEvidenceChainLink(fileRecord, claimId);

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
    const canAudit = req.user.role === "ADMIN" || req.user.role === "AUDITOR";

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

    await assertClaimBelongsToWallet(claimId, req.user.walletAddress);

    await assignEvidenceChainLink(fileRecord, claimId);

    res.status(200).json({
      success: true,
      message: "Document linked to claim successfully",
      document: formatDocumentRecord(fileRecord),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  uploadDocument,
  verifyDocument,
  attachClaimIdToDocument,
};
