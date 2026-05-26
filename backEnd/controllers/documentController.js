const File = require("../models/File");
const { calculateSHA256 } = require("../services/hashService");
const { uploadToPinata } = require("../services/ipfsService");

const uploadDocument = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Document file is required",
      });
    }

    const { claimId = "", documentType = "CLAIM_DOCUMENT" } = req.body;

    const sha256Hash = calculateSHA256(req.file.buffer);

    const ipfsCID = await uploadToPinata(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    const fileRecord = await File.create({
      claimId,
      uploaderWallet: req.user.walletAddress,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sha256Hash,
      ipfsCID,
      documentType,
    });

    res.status(201).json({
      success: true,
      message: "Document uploaded successfully",
      document: {
        id: fileRecord._id,
        claimId: fileRecord.claimId,
        originalName: fileRecord.originalName,
        mimeType: fileRecord.mimeType,
        sha256Hash: fileRecord.sha256Hash,
        ipfsCID: fileRecord.ipfsCID,
        documentType: fileRecord.documentType,
      },
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

    res.status(200).json({
      success: true,
      document: {
        id: fileRecord._id,
        claimId: fileRecord.claimId,
        uploaderWallet: fileRecord.uploaderWallet,
        originalName: fileRecord.originalName,
        mimeType: fileRecord.mimeType,
        sha256Hash: fileRecord.sha256Hash,
        ipfsCID: fileRecord.ipfsCID,
        documentType: fileRecord.documentType,
        uploadedAt: fileRecord.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  uploadDocument,
  verifyDocument,
};