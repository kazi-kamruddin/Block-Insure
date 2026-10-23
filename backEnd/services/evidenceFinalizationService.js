const { assignEvidenceChainLink } = require("./evidenceChainService");
const { appendEvidenceEvent } = require("./evidenceTransparencyService");

// Both normal attachment and transaction recovery must enforce the same envelope
// boundary and complete the transparency record before reporting success.
const finalizeEvidence = async ({ file, claim, version, attempt, actorWallet }) => {
  const claimId = claim.claimId.toString();
  const envelopes = [claimId, `attempt:${attempt._id}`];
  if (!envelopes.includes(file.envelopeClaimId) ||
      file.claimVersion !== Number(version) ||
      file.uploaderWallet.toLowerCase() !== actorWallet.toLowerCase() ||
      attempt.policyId !== claim.policyId.toString() ||
      String(attempt.documentId) !== String(file._id) ||
      claim.documentHash.toLowerCase() !== `0x${file.sha256Hash}`.toLowerCase() ||
      claim.documentCID !== file.ipfsCID ||
      (file.claimId && file.claimId !== claimId)) {
    const error = new Error("Evidence envelope, owner, version or policy mismatch");
    error.statusCode = 409;
    throw error;
  }
  const linked = await assignEvidenceChainLink(file, claimId);
  const event = await appendEvidenceEvent({
    idempotencyKey: `evidence-added:${linked._id}:${version}`,
    eventType: "EVIDENCE_ADDED", claimId, claimVersion: Number(version),
    documentId: linked._id, actorWallet,
    ciphertextHash: linked.sha256Hash, ciphertextReference: linked.ipfsCID,
    associatedDataHash: linked.associatedDataHash,
    encryptionSchemeVersion: linked.encryptionSchemeVersion,
  });
  linked.evidenceEventIndex = event.treeIndex;
  await linked.save();
  return linked;
};
module.exports = { finalizeEvidence };
