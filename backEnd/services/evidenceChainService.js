const File = require("../models/File");
const { calculateTextSHA256 } = require("./hashService");

const GENESIS_EVIDENCE_HASH = "GENESIS";
const MAX_CHAIN_ASSIGNMENT_ATTEMPTS = 5;

const normalizeClaimId = (claimId) => {
  const value = String(claimId || "").trim();
  return value.toLowerCase() === "pending" ? "" : value;
};

const buildEvidenceChainHash = ({
  claimId,
  evidenceChainIndex,
  previousEvidenceHash,
  sha256Hash,
  ipfsCID,
  documentType,
  uploaderWallet,
  claimVersion = 0,
  associatedDataHash = "",
  encryptionSchemeVersion = "",
}) => {
  return calculateTextSHA256(
    JSON.stringify({
      claimId: normalizeClaimId(claimId),
      evidenceChainIndex,
      previousEvidenceHash: previousEvidenceHash || GENESIS_EVIDENCE_HASH,
      sha256Hash,
      ipfsCID,
      documentType,
      uploaderWallet: String(uploaderWallet || "").toLowerCase(),
      claimVersion: Number(claimVersion || 0),
      associatedDataHash,
      encryptionSchemeVersion,
    })
  );
};

const formatEvidenceDocument = (fileRecord, expectedHash = "") => {
  const actualHash = buildEvidenceChainHash({
    claimId: fileRecord.claimId,
    evidenceChainIndex: fileRecord.evidenceChainIndex,
    previousEvidenceHash: fileRecord.previousEvidenceHash,
    sha256Hash: fileRecord.sha256Hash,
    ipfsCID: fileRecord.ipfsCID,
    documentType: fileRecord.documentType,
    uploaderWallet: fileRecord.uploaderWallet,
    claimVersion: fileRecord.claimVersion,
    associatedDataHash: fileRecord.associatedDataHash,
    encryptionSchemeVersion: fileRecord.encryptionSchemeVersion,
  });

  return {
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
    recoverableAcrossBrowsers: Boolean(
      fileRecord.keyCapsule && fileRecord.encryptionIdentityVersion
    ),
    uploadedAt: fileRecord.createdAt,
    previousEvidenceHash: fileRecord.previousEvidenceHash || "",
    evidenceChainHash: fileRecord.evidenceChainHash || "",
    evidenceChainIndex: fileRecord.evidenceChainIndex,
    expectedEvidenceHash: expectedHash || actualHash,
    chainLinkVerified:
      Boolean(fileRecord.evidenceChainHash) &&
      fileRecord.evidenceChainHash === (expectedHash || actualHash),
  };
};

const assignEvidenceChainLink = async (fileRecord, claimId) => {
  const normalizedClaimId = normalizeClaimId(claimId);

  if (!normalizedClaimId) {
    return fileRecord;
  }

  if (
    fileRecord.claimId === normalizedClaimId &&
    fileRecord.evidenceChainHash &&
    Number.isInteger(fileRecord.evidenceChainIndex)
  ) {
    return fileRecord;
  }

  for (let attempt = 1; attempt <= MAX_CHAIN_ASSIGNMENT_ATTEMPTS; attempt += 1) {
    const latestDocument = await File.findOne({
      claimId: normalizedClaimId,
      _id: { $ne: fileRecord._id },
      evidenceChainHash: { $ne: "" },
    }).sort({ evidenceChainIndex: -1, createdAt: -1 });

    const previousEvidenceHash =
      latestDocument?.evidenceChainHash || GENESIS_EVIDENCE_HASH;
    const evidenceChainIndex = latestDocument
      ? Number(latestDocument.evidenceChainIndex || 0) + 1
      : 0;
    const evidenceChainHash = buildEvidenceChainHash({
      claimId: normalizedClaimId,
      evidenceChainIndex,
      previousEvidenceHash,
      sha256Hash: fileRecord.sha256Hash,
      ipfsCID: fileRecord.ipfsCID,
      documentType: fileRecord.documentType,
      uploaderWallet: fileRecord.uploaderWallet,
      claimVersion: fileRecord.claimVersion,
      associatedDataHash: fileRecord.associatedDataHash,
      encryptionSchemeVersion: fileRecord.encryptionSchemeVersion,
    });

    fileRecord.claimId = normalizedClaimId;
    fileRecord.previousEvidenceHash = previousEvidenceHash;
    fileRecord.evidenceChainIndex = evidenceChainIndex;
    fileRecord.evidenceChainHash = evidenceChainHash;

    try {
      await fileRecord.save();
      return fileRecord;
    } catch (error) {
      if (error?.code !== 11000 || attempt === MAX_CHAIN_ASSIGNMENT_ATTEMPTS) {
        throw error;
      }

      // Another upload won this index. Reload the head and retry with its hash.
      fileRecord.previousEvidenceHash = "";
      fileRecord.evidenceChainIndex = null;
      fileRecord.evidenceChainHash = "";
    }
  }

  throw new Error("Could not allocate an evidence-chain index");
};

const getEvidenceChainForClaim = async (claimId) => {
  const normalizedClaimId = normalizeClaimId(claimId);

  if (!normalizedClaimId) {
    return {
      claimId: "",
      documentCount: 0,
      headHash: "",
      verified: true,
      documents: [],
    };
  }

  const files = await File.find({ claimId: normalizedClaimId })
    .select("+keyCapsule")
    .sort({
      evidenceChainIndex: 1,
      createdAt: 1,
    });
  let previousHash = GENESIS_EVIDENCE_HASH;
  const documents = files.map((fileRecord, index) => {
    const expectedHash = buildEvidenceChainHash({
      claimId: normalizedClaimId,
      evidenceChainIndex: fileRecord.evidenceChainIndex,
      previousEvidenceHash: previousHash,
      sha256Hash: fileRecord.sha256Hash,
      ipfsCID: fileRecord.ipfsCID,
      documentType: fileRecord.documentType,
      uploaderWallet: fileRecord.uploaderWallet,
      claimVersion: fileRecord.claimVersion,
      associatedDataHash: fileRecord.associatedDataHash,
      encryptionSchemeVersion: fileRecord.encryptionSchemeVersion,
    });
    const document = formatEvidenceDocument(fileRecord, expectedHash);
    const expectedPreviousHash =
      index === 0 ? GENESIS_EVIDENCE_HASH : previousHash;

    document.chainOrderVerified =
      fileRecord.evidenceChainIndex === index &&
      fileRecord.previousEvidenceHash === expectedPreviousHash;
    document.chainLinkVerified =
      document.chainLinkVerified && document.chainOrderVerified;
    previousHash = fileRecord.evidenceChainHash || previousHash;

    return document;
  });
  const headDocument = documents[documents.length - 1];

  return {
    claimId: normalizedClaimId,
    documentCount: documents.length,
    headHash: headDocument?.evidenceChainHash || "",
    genesisHash: GENESIS_EVIDENCE_HASH,
    verified: documents.every((document) => document.chainLinkVerified),
    documents,
  };
};

module.exports = {
  GENESIS_EVIDENCE_HASH,
  assignEvidenceChainLink,
  buildEvidenceChainHash,
  getEvidenceChainForClaim,
  normalizeClaimId,
};
