const { ethers } = require("ethers");
const mongoose = require("mongoose");
const File = require("../models/File");
const Bundle = require("../models/EvidenceBundle");
const { getDeploymentScope } = require("./deploymentScopeService");
const { assignEvidenceChainLink } = require("./evidenceChainService");
const { appendEvidenceEvent } = require("./evidenceTransparencyService");
const fail = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
const MAX_FILES = 5;
const MAX_REVIEW_FILES = 7; // Initial five plus bounded corrective-appeal evidence.
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

// The transparency log is deliberately one deployment per database. Refuse a
// reused database instead of mixing identical claim IDs or silently resetting it.
async function assertEvidenceDeployment() {
  const deploymentScope = await getDeploymentScope();
  const collection = mongoose.connection.collection("evidence_deployment_binding");
  try { await collection.updateOne({ _id: "binding" }, { $setOnInsert: { deploymentScope } }, { upsert: true }); }
  catch (error) { if (error.code !== 11000) throw error; }
  const binding = await collection.findOne({ _id: "binding" });
  if (binding.deploymentScope !== deploymentScope) throw fail("Evidence database belongs to another deployment. Select a fresh application database.");
  return deploymentScope;
}

function buildManifest({ deploymentScope, claimId, claimVersion, documents }) {
  if (!documents.length || documents.length > MAX_REVIEW_FILES || documents[0].documentType !== "HOSPITAL_BILL") {
    throw fail("One primary hospital invoice and a bounded supporting/appeal evidence set are required.");
  }
  const manifest = JSON.stringify({ schemaVersion: 1, deploymentScope, claimId: String(claimId), claimVersion: Number(claimVersion),
    documents: documents.map((file, index) => ({ index, documentId: String(file._id), sourceClaimVersion: file.claimVersion,
      documentType: file.documentType, ciphertextHash: file.sha256Hash, ciphertextReference: file.ipfsCID,
      associatedDataHash: file.associatedDataHash, encryptionSchemeVersion: file.encryptionSchemeVersion })) });
  return { manifest, manifestHash: ethers.keccak256(ethers.toUtf8Bytes(manifest)) };
}

async function sealBundle({ claimId, claimVersion, ownerWallet, documents }) {
  const deploymentScope = await assertEvidenceDeployment();
  if (documents.some((file) => file.uploaderWallet !== ownerWallet.toLowerCase()
    || (file.deploymentScope && file.deploymentScope !== deploymentScope) || String(file.claimId) !== String(claimId))) throw fail("Evidence owner, deployment or claim mismatch.");
  const definition = buildManifest({ deploymentScope, claimId, claimVersion, documents });
  const key = { deploymentScope, claimId: String(claimId), claimVersion: Number(claimVersion) };
  let bundle;
  try { bundle = await Bundle.findOneAndUpdate(key, { $setOnInsert: { ...key, ownerWallet, documentIds: documents.map((file) => String(file._id)), ...definition } }, { upsert: true, returnDocument: "after" }); }
  catch (error) { if (error.code !== 11000) throw error; bundle = await Bundle.findOne(key); }
  if (bundle.manifestHash !== definition.manifestHash) throw fail("This claim version already has a different sealed evidence set.");
  await appendEvidenceEvent({ idempotencyKey: `bundle:${deploymentScope}:${claimId}:${claimVersion}`, eventType: "EVIDENCE_SET_SEALED",
    claimId: String(claimId), claimVersion: Number(claimVersion), actorWallet: ownerWallet, manifestHash: bundle.manifestHash });
  return bundle;
}

async function finalizeAttemptBundle({ attempt, claim, version, actorWallet }) {
  const ids = attempt.documentIds?.length ? attempt.documentIds : [String(attempt.documentId)];
  if (ids.length !== (attempt.expectedEvidenceCount || 1)) throw fail("The selected evidence bundle is not fully uploaded.");
  const files = await File.find({ _id: { $in: ids } });
  const ordered = ids.map((id) => files.find((file) => String(file._id) === String(id)));
  if (ordered.some((file) => !file)) throw fail("An uploaded evidence record is unavailable.");
  for (const file of ordered) {
    if (file.uploaderWallet !== actorWallet.toLowerCase() || file.envelopeClaimId !== `attempt:${attempt._id}` || file.claimVersion !== 1
      || (file.claimId && file.claimId !== String(claim.claimId))) throw fail("Evidence envelope does not match the submission attempt.");
    await assignEvidenceChainLink(file, String(claim.claimId));
    const event = await appendEvidenceEvent({ idempotencyKey: `evidence-added:${file._id}:1`, eventType: "EVIDENCE_ADDED",
      claimId: String(claim.claimId), claimVersion: 1, documentId: file._id, actorWallet,
      ciphertextHash: file.sha256Hash, ciphertextReference: file.ipfsCID, associatedDataHash: file.associatedDataHash,
      encryptionSchemeVersion: file.encryptionSchemeVersion });
    file.evidenceEventIndex = event.treeIndex;
    await file.save();
  }
  return sealBundle({ claimId: claim.claimId, claimVersion: version, ownerWallet: actorWallet, documents: ordered });
}

async function getBundle(claimId, claimVersion) {
  return Bundle.findOne({ deploymentScope: await assertEvidenceDeployment(), claimId: String(claimId), claimVersion: Number(claimVersion) });
}

module.exports = { MAX_FILES, MAX_REVIEW_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES, fail, buildManifest, assertEvidenceDeployment, sealBundle, finalizeAttemptBundle, getBundle };
