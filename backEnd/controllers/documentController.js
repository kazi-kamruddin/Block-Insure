const File = require("../models/File");
const { finalizeEvidence } = require("../services/evidenceFinalizationService");
const User = require("../models/User");
const EvidenceGrant = require("../models/EvidenceGrant");
const EvidenceAccessLog = require("../models/EvidenceAccessLog");
const ClaimSubmissionAttempt = require("../models/ClaimSubmissionAttempt");
const { assignEvidenceChainLink, normalizeClaimId } = require("../services/evidenceChainService");
const {
  getClaimAdjudicator,
  getEvidenceRegistry,
  getReadOnlyContract,
} = require("../services/contractService");
const { calculateSHA256, calculateTextSHA256 } = require("../services/hashService");
const { unpinFromPinata, uploadToPinata } = require("../services/ipfsService");
const { notifyAdmins } = require("../services/notificationService");
const {
  deserializeCryptoObject,
  getProxyPublicSigningKey,
  transformEncryptedKey,
} = require("../services/preTransformService");
const {
  appendEvidenceEvent,
  createSignedTreeHead,
  getEvidenceReceipt,
} = require("../services/evidenceTransparencyService");

const SCHEME_VERSION = "RECRYPT-RS-0.15+A256GCM";
const bundles = require("../services/evidenceBundleService");

const formatDocumentRecord = (fileRecord) => ({
  id: fileRecord._id,
  claimId: fileRecord.claimId,
  claimVersion: fileRecord.claimVersion,
  uploaderWallet: fileRecord.uploaderWallet,
  originalName: fileRecord.originalName,
  mimeType: fileRecord.mimeType,
  sha256Hash: fileRecord.sha256Hash,
  ipfsCID: fileRecord.ipfsCID,
  ciphertextReference: fileRecord.ipfsCID,
  ciphertextHash: fileRecord.sha256Hash,
  documentType: fileRecord.documentType,
  encrypted: Boolean(fileRecord.encrypted),
  encryptionAlgorithm: fileRecord.encryptionAlgorithm || "",
  encryptionSchemeVersion: fileRecord.encryptionSchemeVersion || "",
  originalMimeType: fileRecord.originalMimeType || "",
  keyProvider: fileRecord.keyProvider || "",
  keyId: fileRecord.keyId || "",
  associatedDataHash: fileRecord.associatedDataHash || "",
  encryptionIdentityVersion: fileRecord.encryptionIdentityVersion || 0,
  recoverableAcrossBrowsers: Boolean(fileRecord.keyCapsule || fileRecord.keyId),
  previousEvidenceHash: fileRecord.previousEvidenceHash,
  evidenceChainHash: fileRecord.evidenceChainHash,
  evidenceChainIndex: fileRecord.evidenceChainIndex,
  evidenceEventIndex: fileRecord.evidenceEventIndex,
  uploadedAt: fileRecord.createdAt,
});

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

const isAssignedReviewer = async (fileRecord, user) => {
  if (user.role !== "AUDITOR" || !fileRecord.claimId) return false;
  const contract = getReadOnlyContract();
  const adjudicator = await getClaimAdjudicator(contract);
  const version = Number(await contract.claimVersion(fileRecord.claimId));
  const bundle = await bundles.getBundle(fileRecord.claimId, version);
  return Boolean(bundle?.documentIds.includes(String(fileRecord._id))) && adjudicator.isAssigned(fileRecord.claimId, version, user.walletAddress);
};

const assertSensitiveDocumentAccess = async (fileRecord, user) => {
  const isOwner = fileRecord.uploaderWallet.toLowerCase() === user.walletAddress.toLowerCase();
  if (isOwner || (await isAssignedReviewer(fileRecord, user))) return { isOwner };
  const error = new Error("Evidence access requires claim ownership or current auditor assignment");
  error.statusCode = 403;
  throw error;
};

const validateEncryptionIdentity = (publicKey, signingPublicKey) => {
  const decodedPublicKey = deserializeCryptoObject(publicKey);
  const decodedSigningKey = deserializeCryptoObject(signingPublicKey);
  if (
    !decodedPublicKey?.x ||
    !decodedPublicKey?.y ||
    decodedPublicKey.x.length !== 32 ||
    decodedPublicKey.y.length !== 32 ||
    !Buffer.isBuffer(decodedSigningKey) ||
    decodedSigningKey.length !== 32
  ) {
    const error = new Error("Invalid Recrypt encryption identity");
    error.statusCode = 400;
    throw error;
  }
  return { publicKey: decodedPublicKey, signingPublicKey: decodedSigningKey };
};

const getActiveOnChainIdentity = async (
  walletAddress,
  serializedPublicKey,
  serializedSigningKey
) => {
  const decoded = validateEncryptionIdentity(
    serializedPublicKey,
    serializedSigningKey
  );
  const identity = await getEvidenceRegistry().getEncryptionIdentity(walletAddress);
  const expectedPublicKey = `0x${Buffer.concat([
    decoded.publicKey.x,
    decoded.publicKey.y,
  ]).toString("hex")}`;
  const expectedSigningKey = `0x${decoded.signingPublicKey.toString("hex")}`;
  if (
    identity.revokedAt !== 0n ||
    identity.publicKey.toLowerCase() !== expectedPublicKey.toLowerCase() ||
    identity.signingPublicKey.toLowerCase() !== expectedSigningKey.toLowerCase()
  ) {
    const error = new Error("Backend identity does not match an active on-chain identity");
    error.statusCode = 409;
    throw error;
  }
  return identity;
};

const registerEncryptionIdentity = async (req, res, next) => {
  try {
    const {
      publicKey,
      signingPublicKey,
      schemeVersion,
      encryptedPrivateKeyBackup,
    } = req.body;
    if (schemeVersion !== SCHEME_VERSION || !publicKey || !signingPublicKey) {
      return res.status(400).json({ success: false, message: "A supported encryption identity is required" });
    }
    const onChainIdentity = await getActiveOnChainIdentity(
      req.user.walletAddress,
      publicKey,
      signingPublicKey
    );
    if (!encryptedPrivateKeyBackup || encryptedPrivateKeyBackup.length > 100000) {
      return res.status(400).json({ success: false, message: "A wallet-wrapped identity backup is required" });
    }
    const version = Number(onChainIdentity.version);
    await User.updateOne(
      { walletAddress: req.user.walletAddress },
      {
        $set: {
          encryptionPublicKey: publicKey,
          encryptionSigningPublicKey: signingPublicKey,
          encryptedEvidenceIdentityBackup: encryptedPrivateKeyBackup,
          encryptionKeyVersion: version,
          encryptionSchemeVersion: schemeVersion,
          encryptionKeyRevokedAt: null,
        },
      }
    );
    res.status(200).json({ success: true, identity: { version, schemeVersion } });
  } catch (error) {
    next(error);
  }
};

const getEncryptionPublicKey = async (req, res, next) => {
  try {
    const user = await User.findOne({ walletAddress: req.user.walletAddress })
      .select("+encryptionPublicKey +encryptionSigningPublicKey +encryptedEvidenceIdentityBackup encryptionKeyVersion encryptionSchemeVersion encryptionKeyRevokedAt")
      .lean();
    res.status(200).json({
      success: true,
      key: {
        deploymentScope: await bundles.assertEvidenceDeployment(),
        schemeVersion: SCHEME_VERSION,
        version: user?.encryptionKeyVersion || 0,
        registered: Boolean(user?.encryptionPublicKey && !user?.encryptionKeyRevokedAt),
        publicKey: user?.encryptionPublicKey || "",
        signingPublicKey: user?.encryptionSigningPublicKey || "",
        encryptedPrivateKeyBackup: user?.encryptedEvidenceIdentityBackup || "",
        proxySigningPublicKey: getProxyPublicSigningKey(),
      },
    });
  } catch (error) {
    next(error);
  }
};

const getRecipientEncryptionIdentity = async (req, res, next) => {
  try {
    const targetWallet = String(req.params.walletAddress || "").toLowerCase();
    const claimId = normalizeClaimId(req.query.claimId);
    if (targetWallet !== req.user.walletAddress.toLowerCase()) {
      await assertClaimBelongsToWallet(claimId, req.user.walletAddress);
      const contract = getReadOnlyContract();
      const adjudicator = await getClaimAdjudicator(contract);
      const version = await contract.claimVersion(claimId);
      if (!(await adjudicator.isAssigned(claimId, version, targetWallet))) {
        return res.status(403).json({ success: false, message: "Target wallet is not assigned to this claim" });
      }
    }
    const target = await User.findOne({ walletAddress: targetWallet })
      .select("+encryptionPublicKey +encryptionSigningPublicKey encryptionKeyVersion encryptionSchemeVersion encryptionKeyRevokedAt")
      .lean();
    if (!target?.encryptionPublicKey || target.encryptionKeyRevokedAt) {
      return res.status(409).json({ success: false, message: "Target wallet has no active encryption identity" });
    }
    await getActiveOnChainIdentity(
      targetWallet,
      target.encryptionPublicKey,
      target.encryptionSigningPublicKey
    );
    res.status(200).json({
      success: true,
      identity: {
        walletAddress: targetWallet,
        publicKey: target.encryptionPublicKey,
        signingPublicKey: target.encryptionSigningPublicKey,
        version: target.encryptionKeyVersion,
        schemeVersion: target.encryptionSchemeVersion,
      },
    });
  } catch (error) {
    next(error);
  }
};

const uploadDocument = async (req, res, next) => {
  let activeAttempt;
  let createdFileRecord;
  let uploadedCid = "";
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "Document file is required" });
    const documentType = String(req.body.documentType || "CLAIM_DOCUMENT");
    const claimId = normalizeClaimId(req.body.claimId);
    const attemptId = String(req.body.attemptId || "").trim();
    const encrypted = String(req.body.encrypted || "").toLowerCase() === "true";
    const encryptionAlgorithm = String(req.body.encryptionAlgorithm || "").trim();
    const originalMimeType = String(req.body.originalMimeType || "").trim();
    const originalName = String(req.body.originalName || "").trim();
    const keyCapsule = String(req.body.keyCapsule || "").trim();
    const associatedData = String(req.body.associatedData || "").trim();
    const identityVersion = Number(req.body.encryptionIdentityVersion || 0);

    if (!encrypted || req.file.mimetype !== "application/octet-stream") {
      return res.status(400).json({ success: false, message: "Evidence must be encrypted before upload" });
    }
    if (req.file.buffer.subarray(0, 8).toString("utf8") !== "BINSENC2") {
      return res.status(400).json({ success: false, message: "Encrypted evidence header is invalid" });
    }
    if (req.file.buffer.length <= 36 || req.file.buffer.length > bundles.MAX_FILE_BYTES + 36 || !["application/pdf", "image/jpeg", "image/png"].includes(originalMimeType)) {
      return res.status(413).json({ success: false, message: "Use nonempty PDF/JPEG/PNG evidence up to 8 MiB per original file" });
    }
    if (encryptionAlgorithm !== "AES-256-GCM" || !keyCapsule || !associatedData) {
      return res.status(400).json({ success: false, message: "PRE envelope fields are incomplete" });
    }
    deserializeCryptoObject(keyCapsule);
    let aad;
    try {
      aad = JSON.parse(associatedData);
    } catch {
      return res.status(400).json({ success: false, message: "Authenticated evidence metadata is invalid" });
    }
    if (
      String(aad.uploader || "").toLowerCase() !== req.user.walletAddress.toLowerCase() ||
      String(aad.evidenceType || "") !== documentType ||
      !String(aad.claimId || "") ||
      (!Number.isSafeInteger(Number(aad.claimVersion)) || Number(aad.claimVersion) < 1)
    ) {
      return res.status(400).json({ success: false, message: "Evidence associated data does not match this upload" });
    }
    const identity = await User.findOne({ walletAddress: req.user.walletAddress })
      .select("encryptionKeyVersion encryptionKeyRevokedAt")
      .lean();
    if (!identity || identity.encryptionKeyRevokedAt || identity.encryptionKeyVersion !== identityVersion) {
      return res.status(409).json({ success: false, message: "Encryption identity is missing, stale, or revoked" });
    }
    if (!attemptId && !claimId) {
      return res.status(400).json({ success: false, message: "A claim attempt or owned claim is required" });
    }

    let attempt = null;
    if (aad.deploymentScope !== await bundles.assertEvidenceDeployment()) {
      return res.status(409).json({ success: false, message: "Evidence is bound to another deployment" });
    }
    if (attemptId) {
      if (String(aad.claimId) !== `attempt:${attemptId}` || Number(aad.claimVersion) !== 1) {
        return res.status(409).json({ success: false, message: "Envelope must bind the authorized submission attempt" });
      }
      if (!/^[a-f\d]{24}$/i.test(attemptId)) {
        return res.status(400).json({ success: false, message: "Claim submission attempt id is invalid" });
      }
      const slot = Number(aad.fileSlot || 0);
      if (!Number.isSafeInteger(slot) || slot < 0 || slot >= bundles.MAX_FILES ||
          documentType !== (slot === 0 ? "HOSPITAL_BILL" : "SUPPORTING_DOCUMENT")) {
        return res.status(422).json({ success: false, message: "Invalid primary/supporting evidence slot" });
      }
      if (!["application/pdf", "image/jpeg", "image/png"].includes(originalMimeType) ||
          req.file.buffer.length > bundles.MAX_FILE_BYTES + 36) {
        return res.status(413).json({ success: false, message: "Use PDF/JPEG/PNG evidence up to 8 MiB per original file" });
      }
      const scope = await bundles.assertEvidenceDeployment();
      const owned = await ClaimSubmissionAttempt.findOne({ _id: attemptId, walletAddress: req.user.walletAddress, deploymentScope: scope });
      if (!owned || owned.sealedAt || slot >= owned.expectedEvidenceCount) {
        return res.status(409).json({ success: false, message: "Attempt is sealed, unavailable or has no such selected file slot" });
      }
      const existing = await File.findOne({ attemptId, uploadSlot: slot });
      if (existing) {
        if (existing.sha256Hash !== calculateSHA256(req.file.buffer)) return res.status(409).json({ success: false, message: "This slot already contains another encrypted file; resume the stored attempt" });
        await recoverAttemptUploads(owned);
        return res.status(200).json({ success: true, document: formatDocumentRecord(existing) });
      }
      attempt = await ClaimSubmissionAttempt.findOneAndUpdate(
        {
          _id: attemptId,
          walletAddress: req.user.walletAddress,
          expiresAt: { $gt: new Date() },
          deploymentScope: scope,
          sealedAt: null,
          $or: [{ status: { $in: ["AUTHORIZED", "UPLOADED"] } }, { status: "UPLOADING", uploadLeaseUntil: { $lt: new Date() } }],
        },
        { $set: { status: "UPLOADING", failureReason: "", uploadLeaseUntil: new Date(Date.now() + 120000) } },
        { returnDocument: "after" }
      );
      if (!attempt) {
        return res.status(409).json({ success: false, message: "Claim attempt is unavailable or expired" });
      }
      activeAttempt = attempt;
      const uploaded = await File.find({ attemptId }).select("encryptedBytes").lean();
      if (uploaded.reduce((sum, file) => sum + file.encryptedBytes, req.file.buffer.length) > bundles.MAX_TOTAL_BYTES + bundles.MAX_FILES * 36) {
        throw bundles.fail("Evidence bundle exceeds 20 MiB of original files", 413);
      }
    }
    if (claimId) {
      const claim = await assertClaimBelongsToWallet(claimId, req.user.walletAddress);
      const contract = getReadOnlyContract();
      const nextVersion = Number(await contract.claimVersion(claimId)) + 1;
      const draft = await require("../models/AppealSubmissionAttempt").findOne({ deploymentScope: await bundles.assertEvidenceDeployment(), claimId,
        claimVersion: nextVersion, ownerWallet: req.user.walletAddress, status: "DRAFT" });
      if (Number(claim.status) !== 8 || Number(aad.claimVersion) !== nextVersion || documentType !== "APPEAL_DOCUMENT" || !draft) {
        return res.status(409).json({ success: false, message: "Prepare the rejected claim's appeal draft before uploading its version-bound attachment" });
      }
      if (await File.exists({ claimId, claimVersion: nextVersion, documentType: "APPEAL_DOCUMENT" })) {
        return res.status(409).json({ success: false, message: "This appeal already has a stored attachment. Resume the saved draft rather than uploading again." });
      }
      if (String(aad.claimId) !== claimId) {
        return res.status(409).json({ success: false, message: "Envelope is bound to another claim" });
      }
    }

    const sha256Hash = calculateSHA256(req.file.buffer);
    uploadedCid = await uploadToPinata(req.file.buffer, req.file.originalname, req.file.mimetype);
    let fileRecord = await File.create({
      deploymentScope: attempt?.deploymentScope || await bundles.assertEvidenceDeployment(),
      attemptId,
      uploadSlot: Number(aad.fileSlot || 0),
      encryptedBytes: req.file.buffer.length,
      claimId,
      claimVersion: Number(aad.claimVersion),
      envelopeClaimId: String(aad.claimId),
      uploaderWallet: req.user.walletAddress,
      originalName: originalName || req.file.originalname.replace(/\.binsenc$/i, ""),
      mimeType: req.file.mimetype,
      sha256Hash,
      ipfsCID: uploadedCid,
      documentType,
      encrypted: true,
      encryptionAlgorithm,
      originalMimeType,
      keyProvider: "RECRYPT_PROXY",
      keyId: `recrypt:${identityVersion}`,
      encryptionSchemeVersion: SCHEME_VERSION,
      keyCapsule,
      authenticatedAssociatedData: associatedData,
      associatedDataHash: calculateTextSHA256(associatedData),
      encryptionIdentityVersion: identityVersion,
    });
    createdFileRecord = fileRecord;
    if (claimId) {
      fileRecord = await assignEvidenceChainLink(fileRecord, claimId);
      const event = await appendEvidenceEvent({
        eventType: "EVIDENCE_ADDED",
        claimId,
        claimVersion: fileRecord.claimVersion,
        documentId: fileRecord._id,
        actorWallet: req.user.walletAddress,
        ciphertextHash: sha256Hash,
        ciphertextReference: uploadedCid,
        associatedDataHash: fileRecord.associatedDataHash,
        encryptionSchemeVersion: SCHEME_VERSION,
      });
      fileRecord.evidenceEventIndex = event.treeIndex;
      await fileRecord.save();
      await require("../models/AppealSubmissionAttempt").updateOne({ deploymentScope: fileRecord.deploymentScope, claimId,
        claimVersion: fileRecord.claimVersion, ownerWallet: req.user.walletAddress, status: "DRAFT" }, { $set: {
        "payload.additionalDocumentHash": sha256Hash, "payload.additionalDocumentCID": uploadedCid,
      } });
    }
    if (attempt) {
      await recoverAttemptUploads(attempt);
    }
    res.status(201).json({ success: true, message: "Document uploaded successfully", document: formatDocumentRecord(fileRecord) });
  } catch (error) {
    if (activeAttempt) {
      await ClaimSubmissionAttempt.updateOne(
        { _id: activeAttempt._id, status: "UPLOADING" },
        { $set: { status: "AUTHORIZED", failureReason: error.message } }
      ).catch(() => {});
    }
    // A stored file may outlive a lost acknowledgement. Keep it recoverable by
    // its immutable attempt/slot rather than deleting possibly committed work.
    if (uploadedCid && !createdFileRecord && !await File.exists({ ipfsCID: uploadedCid })) await unpinFromPinata(uploadedCid).catch(() => {});
    next(error);
  }
};

async function recoverAttemptUploads(attempt) {
  const files = await File.find({ attemptId: String(attempt._id) }).sort({ uploadSlot: 1 });
  const complete = files.length === attempt.expectedEvidenceCount && files.every((file, index) => file.uploadSlot === index);
  await ClaimSubmissionAttempt.updateOne({ _id: attempt._id, sealedAt: null, status: { $in: ["AUTHORIZED", "UPLOADING", "UPLOADED"] } }, { $set: {
    documentIds: files.map((file) => String(file._id)), documentId: files.find((file) => file.uploadSlot === 0)?._id.toString() || "",
    encryptedBytes: files.reduce((sum, file) => sum + file.encryptedBytes, 0), uploadLeaseUntil: null,
    status: complete ? "UPLOADED" : "AUTHORIZED",
  } });
}

const verifyDocument = async (req, res, next) => {
  try {
    const fileRecord = await File.findById(req.params.id);
    if (!fileRecord) return res.status(404).json({ success: false, message: "Document record not found" });
    await assertSensitiveDocumentAccess(fileRecord, req.user);
    res.status(200).json({ success: true, document: formatDocumentRecord(fileRecord) });
  } catch (error) {
    next(error);
  }
};

const getDecryptionKey = async (req, res, next) => {
  try {
    const fileRecord = await File.findById(req.params.id).select(
      "+keyCapsule +authenticatedAssociatedData"
    );
    if (!fileRecord) return res.status(404).json({ success: false, message: "Document record not found" });
    const { isOwner } = await assertSensitiveDocumentAccess(fileRecord, req.user);
    let capsule = fileRecord.keyCapsule;
    let action = "RETRIEVE_CAPSULE";
    if (!isOwner) {
      const contract = getReadOnlyContract();
      const currentClaimVersion = Number(
        await contract.claimVersion(fileRecord.claimId)
      );
      const grant = await EvidenceGrant.findOne({
        documentId: fileRecord._id,
        granteeWallet: req.user.walletAddress,
        claimVersion: currentClaimVersion,
        revokedAt: null,
      }).select("+transformKey");
      if (!grant) {
        return res.status(403).json({ success: false, message: "No active cryptographic delegation exists" });
      }
      const bundle = await bundles.getBundle(fileRecord.claimId, currentClaimVersion);
      if (!bundle || grant.manifestHash !== bundle.manifestHash) {
        return res.status(403).json({ success: false, message: "Delegation does not authorize the current sealed evidence set" });
      }
      const granteeIdentity = await User.findOne({
        walletAddress: req.user.walletAddress,
      })
        .select("+encryptionPublicKey +encryptionSigningPublicKey encryptionKeyVersion encryptionKeyRevokedAt")
        .lean();
      if (
        !granteeIdentity?.encryptionPublicKey ||
        granteeIdentity.encryptionKeyRevokedAt ||
        granteeIdentity.encryptionKeyVersion !== grant.granteeKeyVersion
      ) {
        return res.status(403).json({ success: false, message: "Delegated encryption identity is stale or revoked" });
      }
      await getActiveOnChainIdentity(
        req.user.walletAddress,
        granteeIdentity.encryptionPublicKey,
        granteeIdentity.encryptionSigningPublicKey
      );
      capsule = transformEncryptedKey(fileRecord.keyCapsule, grant.transformKey);
      action = "PROXY_TRANSFORM";
    }
    await EvidenceAccessLog.create({
      documentId: fileRecord._id,
      claimId: fileRecord.claimId,
      actorWallet: req.user.walletAddress,
      actorRole: req.user.role,
      action,
      userAgent: req.get("user-agent") || "",
    });
    res.status(200).json({
      success: true,
      decryption: {
        algorithm: fileRecord.encryptionAlgorithm,
        keyCapsule: capsule,
        transformed: !isOwner,
        associatedData: fileRecord.authenticatedAssociatedData,
        associatedDataHash: fileRecord.associatedDataHash,
        encryptedSha256Hash: fileRecord.sha256Hash,
        originalName: fileRecord.originalName,
        originalMimeType: fileRecord.originalMimeType || "application/octet-stream",
        schemeVersion: fileRecord.encryptionSchemeVersion,
      },
    });
  } catch (error) {
    next(error);
  }
};

const grantEvidenceAccess = async (_req, res) => res.status(410).json({
  success: false, message: "Use batch authorization for the assigned panel and sealed evidence set",
});

const revokeEvidenceAccess = async (req, res, next) => {
  try {
    const fileRecord = await File.findById(req.params.id);
    if (!fileRecord) return res.status(404).json({ success: false, message: "Document record not found" });
    if (fileRecord.uploaderWallet !== req.user.walletAddress.toLowerCase()) {
      return res.status(403).json({ success: false, message: "Only the evidence owner can revoke access" });
    }
    const granteeWallet = String(req.body.granteeWallet || "").toLowerCase();
    const contract = getReadOnlyContract();
    const currentClaimVersion = Number(
      await contract.claimVersion(fileRecord.claimId)
    );
    const grant = await EvidenceGrant.findOneAndUpdate(
      {
        documentId: fileRecord._id,
        granteeWallet,
        claimVersion: currentClaimVersion,
        revokedAt: null,
      },
      { $set: { revokedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (!grant) return res.status(404).json({ success: false, message: "Active delegation not found" });
    await require("../models/ReviewAccessBatch").updateOne({ deploymentScope: grant.deploymentScope,
      claimId: fileRecord.claimId, claimVersion: grant.claimVersion }, { $set: { status: "STALE" } });
    await appendEvidenceEvent({
      eventType: "ACCESS_REVOKED",
      claimId: fileRecord.claimId,
      claimVersion: grant.claimVersion,
      documentId: fileRecord._id,
      actorWallet: req.user.walletAddress,
      granteeWallet,
    });
    await EvidenceAccessLog.create({
      documentId: fileRecord._id,
      claimId: fileRecord.claimId,
      actorWallet: req.user.walletAddress,
      actorRole: req.user.role,
      action: "REVOKE",
      userAgent: req.get("user-agent") || "",
    });
    res.status(200).json({ success: true, message: "Delegation revoked for future access" });
  } catch (error) {
    next(error);
  }
};

const attachClaimIdToDocument = async (req, res, next) => {
  try {
    const fileRecord = await File.findById(req.params.id);
    if (!fileRecord) return res.status(404).json({ success: false, message: "Document record not found" });
    if (fileRecord.uploaderWallet !== req.user.walletAddress.toLowerCase()) {
      return res.status(403).json({ success: false, message: "Document does not belong to this wallet" });
    }
    const claimId = normalizeClaimId(req.body.claimId);
    if (!claimId || ![claimId, `attempt:${String(req.body.attemptId || "").trim()}`].includes(fileRecord.envelopeClaimId)) {
      return res.status(409).json({ success: false, message: "Evidence envelope is bound to another claim" });
    }
    if (fileRecord.claimId && fileRecord.claimId !== claimId) {
      return res.status(409).json({ success: false, message: "Document is already linked" });
    }
    const attemptId = String(req.body.attemptId || "").trim();
    const attempt = await ClaimSubmissionAttempt.findOne({
      _id: attemptId,
      walletAddress: req.user.walletAddress,
      documentId: fileRecord._id.toString(),
      status: { $in: ["UPLOADED", "TX_SUBMITTED", "COMPLETED"] },
    });
    if (!attempt) return res.status(409).json({ success: false, message: "Document is not bound to this claim attempt" });
    const claim = await assertClaimBelongsToWallet(claimId, req.user.walletAddress);
    const contract = getReadOnlyContract();
    const version = Number(await contract.claimVersion(claimId));
    if (version !== fileRecord.claimVersion || attempt.policyId !== claim.policyId.toString()) {
      return res.status(409).json({ success: false, message: "Evidence claim version or policy mismatch" });
    }
    const linkedDocument = await finalizeEvidence({ file: fileRecord, claim, version, attempt, actorWallet: req.user.walletAddress });
    await bundles.finalizeAttemptBundle({ attempt, claim, version: 1, actorWallet: req.user.walletAddress });
    await ClaimSubmissionAttempt.updateOne(
      { _id: attempt._id },
      { $set: { claimId, status: "COMPLETED", completedAt: new Date(), expiresAt: null } }
    );
    await notifyAdmins({
      actorWallet: req.user.walletAddress,
      type: "CLAIM_SUBMITTED",
      title: `New claim #${claimId} submitted`,
      message: `A new claim was submitted by ${req.user.walletAddress}.`,
      claimId,
      link: `/admin/claims/${claimId}`,
      dedupeKey: `claim:${claimId}:submitted`,
    });
    res.status(200).json({ success: true, message: "Document linked to claim", document: formatDocumentRecord(linkedDocument) });
  } catch (error) {
    next(error);
  }
};

const getReceipt = async (req, res, next) => {
  try {
    const fileRecord = await File.findById(req.params.id);
    if (!fileRecord) return res.status(404).json({ success: false, message: "Document record not found" });
    await assertSensitiveDocumentAccess(fileRecord, req.user);
    if (
      fileRecord.evidenceEventIndex === null ||
      fileRecord.evidenceEventIndex === undefined
    ) {
      return res.status(409).json({ success: false, message: "Evidence event is not logged yet" });
    }
    await createSignedTreeHead();
    res.status(200).json({ success: true, receipt: await getEvidenceReceipt(fileRecord.evidenceEventIndex) });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  attachClaimIdToDocument,
  getDecryptionKey,
  getEncryptionPublicKey,
  getReceipt,
  getRecipientEncryptionIdentity,
  grantEvidenceAccess,
  registerEncryptionIdentity,
  revokeEvidenceAccess,
  uploadDocument,
  verifyDocument,
};
