const { ethers } = require("ethers");
const User = require("../models/User");
const File = require("../models/File");
const Grant = require("../models/EvidenceGrant");
const Batch = require("../models/ReviewAccessBatch");
const { getReadOnlyContract, getClaimAdjudicator, getEvidenceRegistry } = require("./contractService");
const { getBundle, fail, assertEvidenceDeployment } = require("./evidenceBundleService");
const { deserializeCryptoObject, transformEncryptedKey } = require("./preTransformService");
const { executeEvidenceOperation } = require("./evidenceOperationService");
const { notifyWallet } = require("./notificationService");
const { appendEvidenceEvent } = require("./evidenceTransparencyService");

async function recipientIdentity(wallet) {
  const user = await User.findOne({ walletAddress: wallet.toLowerCase() }).select("+encryptionPublicKey +encryptionSigningPublicKey encryptionKeyVersion encryptionKeyRevokedAt").lean();
  if (!user?.encryptionPublicKey || user.encryptionKeyRevokedAt) return null;
  const identity = await getEvidenceRegistry().getEncryptionIdentity(wallet);
  const key = deserializeCryptoObject(user.encryptionPublicKey);
  const publicKey = `0x${Buffer.concat([key.x, key.y]).toString("hex")}`;
  const signingKey = `0x${deserializeCryptoObject(user.encryptionSigningPublicKey).toString("hex")}`;
  if (identity.revokedAt !== 0n || Number(identity.version) !== user.encryptionKeyVersion ||
    identity.publicKey.toLowerCase() !== publicKey.toLowerCase() || identity.signingPublicKey.toLowerCase() !== signingKey.toLowerCase()) return null;
  return { version: user.encryptionKeyVersion, publicKey: user.encryptionPublicKey, signingPublicKey: user.encryptionSigningPublicKey };
}

async function reviewState(claimId) {
  if (!/^[1-9]\d*$/.test(String(claimId))) throw fail("Valid claim ID required", 400);
  const manager = getReadOnlyContract();
  const claim = await manager.getClaim(claimId);
  const version = Number(await manager.claimVersion(claimId));
  const adjudicator = await getClaimAdjudicator(manager);
  const [review, preparation, bundle] = await Promise.all([adjudicator.getReview(claimId, version), adjudicator.getPreparation(claimId, version), getBundle(claimId, version)]);
  const wallets = Array.from(review.auditors).filter((wallet) => wallet !== ethers.ZeroAddress);
  const recipients = await Promise.all(wallets.map(async (wallet) => ({ walletAddress: wallet.toLowerCase(), identity: await recipientIdentity(wallet) })));
  const grants = bundle ? await Grant.find({ deploymentScope: bundle.deploymentScope, claimId: String(claimId), claimVersion: version, manifestHash: bundle.manifestHash, revokedAt: null }).select("documentId granteeWallet granteeKeyVersion").lean() : [];
  const ready = recipients.length === 4 && recipients.every(({ walletAddress, identity }) => identity && bundle?.documentIds.every((id) => grants.some((grant) => String(grant.documentId) === id && grant.granteeWallet === walletAddress && grant.granteeKeyVersion === identity.version)));
  return { manager, claim, version, adjudicator, review, preparation, bundle, recipients, grants, ready };
}

async function statusFor(claimId, user) {
  const state = await reviewState(claimId);
  const owner = state.claim.claimantWallet.toLowerCase() === user.walletAddress.toLowerCase();
  const assigned = user.role === "AUDITOR" && state.recipients.some((recipient) => recipient.walletAddress === user.walletAddress.toLowerCase());
  if (!owner && !assigned && user.role !== "ADMIN") throw fail("Evidence preparation requires ownership or current assignment", 403);
  const now = Number((await state.manager.runner.getBlock("latest")).timestamp);
  const batch = await Batch.findOne({ deploymentScope: state.bundle?.deploymentScope || await assertEvidenceDeployment(), claimId: String(claimId), claimVersion: state.version });
  return { claimId: String(claimId), claimVersion: state.version, state: state.review.finalized ? "FINALIZED" : Number(state.review.deadline) > 0 ? "ACTIVE" : Number(state.preparation.deadline) > 0 ? (now > Number(state.preparation.deadline) ? "PREPARATION_EXPIRED" : "PREPARING") : "NOT_ASSIGNED",
    preparationDeadline: Number(state.preparation.deadline), votingDeadline: Number(state.review.deadline), ready: state.ready,
    evidenceSetHash: state.bundle?.manifestHash || "", activeEvidenceSetHash: state.preparation.evidenceSetHash,
    documentIds: state.bundle?.documentIds || [], owner, recipients: state.recipients.map(({ walletAddress, identity }) => ({ walletAddress, keyReady: Boolean(identity), keyVersion: identity?.version || 0 })),
    batchExists: Boolean(batch), batchStatus: batch?.status || "", grantedCount: state.grants.length, requiredCount: state.recipients.length * (state.bundle?.documentIds.length || 0) };
}

async function prepareBatch(claimId, ownerWallet, payload) {
  const state = await reviewState(claimId);
  if (state.claim.claimantWallet.toLowerCase() !== ownerWallet.toLowerCase()) throw fail("Only the evidence owner can authorize reviewers", 403);
  if (!state.bundle || state.recipients.length !== 4 || state.review.finalized || Number(state.preparation.deadline) === 0) throw fail("A sealed evidence set and assigned review are required");
  if (payload.claimVersion !== state.version || payload.manifestHash !== state.bundle.manifestHash) throw fail("Evidence set or review version changed; refresh before authorizing");
  const entries = payload.grants;
  if (!Array.isArray(entries) || entries.length !== state.bundle.documentIds.length * 4 || entries.length > 28) throw fail("Authorize exactly the assigned panel and sealed evidence set", 422);
  if (entries.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry))) throw fail("Invalid delegation entry", 422);
  const validated = [];
  const files = await File.find({ _id: { $in: state.bundle.documentIds } }).select("+keyCapsule");
  for (const documentId of state.bundle.documentIds) {
    const file = files.find((item) => String(item._id) === documentId);
    if (!file || file.uploaderWallet !== ownerWallet.toLowerCase()) throw fail("An evidence owner or file changed");
    for (const recipient of state.recipients) {
      const matches = entries.filter((entry) => entry.documentId === documentId && entry.granteeWallet === recipient.walletAddress);
      if (matches.length !== 1 || !recipient.identity || matches[0].granteeKeyVersion !== recipient.identity.version) throw fail("An assigned reviewer key is missing or changed");
      const entry = matches[0];
      if (typeof entry.transformKey !== "string" || entry.transformKey.length > 32000) throw fail("Invalid delegation envelope", 422);
      try {
        const transform = deserializeCryptoObject(entry.transformKey);
        const target = deserializeCryptoObject(recipient.identity.publicKey);
        if (!Buffer.from(transform.toPublicKey.x).equals(Buffer.from(target.x)) || !Buffer.from(transform.toPublicKey.y).equals(Buffer.from(target.y))) throw new Error("Recipient key mismatch");
        transformEncryptedKey(file.keyCapsule, entry.transformKey);
      } catch { throw fail("A delegation cannot transform its assigned evidence capsule", 422); }
      validated.push({ documentId, granteeWallet: recipient.walletAddress, granteeKeyVersion: entry.granteeKeyVersion, transformKey: entry.transformKey });
    }
  }
  const grantCommitment = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({ scope: state.bundle.deploymentScope,
    claimId: String(claimId), version: state.version, manifestHash: state.bundle.manifestHash,
    grants: validated.map((entry) => ({ documentId: entry.documentId, recipient: entry.granteeWallet, keyVersion: entry.granteeKeyVersion, transformHash: ethers.id(entry.transformKey) })) })));
  if (Number(state.review.deadline) > 0 && (state.preparation.evidenceSetHash !== state.bundle.manifestHash || state.preparation.grantCommitment !== grantCommitment)) throw fail("Active review commitments cannot be changed");
  const key = { deploymentScope: state.bundle.deploymentScope, claimId: String(claimId), claimVersion: state.version };
  let batch;
  try { batch = await Batch.findOneAndUpdate(key, { $setOnInsert: { ...key, manifestHash: state.bundle.manifestHash, ownerWallet: ownerWallet.toLowerCase(), grantCommitment, grants: validated } }, { upsert: true, returnDocument: "after" }).select("+grants"); }
  catch (error) { if (error.code !== 11000) throw error; batch = await Batch.findOne(key); }
  if (batch.grantCommitment !== grantCommitment) throw fail("This batch has a different durable authorization; resume it rather than replacing it");
  await activateBatch(batch);
  return statusFor(claimId, { walletAddress: ownerWallet, role: "USER" });
}

async function activateBatch(batch) {
  const state = await reviewState(batch.claimId);
  if (state.version !== batch.claimVersion || state.bundle?.manifestHash !== batch.manifestHash) { batch.status = "STALE"; await batch.save(); return; }
  const entries = batch.grants || (await Batch.findById(batch._id).select("+grants")).grants;
  if (entries.some((entry) => !state.recipients.some((recipient) => recipient.walletAddress === entry.granteeWallet && recipient.identity?.version === entry.granteeKeyVersion))) {
    batch.status = "STALE"; await batch.save(); return;
  }
  if (batch.status === "PREPARED") for (const entry of entries) {
    const key = { documentId: entry.documentId, granteeWallet: entry.granteeWallet, claimVersion: batch.claimVersion };
    const existing = await Grant.findOne(key);
    if (existing?.revokedAt) { batch.status = "STALE"; await batch.save(); return; }
    try { await Grant.findOneAndUpdate(key, { $setOnInsert: {
      ...key, deploymentScope: batch.deploymentScope, manifestHash: batch.manifestHash, claimId: batch.claimId, ownerWallet: batch.ownerWallet,
      transformKey: entry.transformKey, granteeKeyVersion: entry.granteeKeyVersion, revokedAt: null,
    } }, { upsert: true, returnDocument: "after" }); }
    catch (error) { if (error.code !== 11000) throw error; }
  }
  await appendEvidenceEvent({ idempotencyKey: `access-batch:${batch.deploymentScope}:${batch.claimId}:${batch.claimVersion}:${batch.grantCommitment}`,
    eventType: "ACCESS_BATCH_AUTHORIZED", claimId: batch.claimId, claimVersion: batch.claimVersion, actorWallet: batch.ownerWallet,
    manifestHash: batch.manifestHash, grantCommitment: batch.grantCommitment,
    recipients: state.recipients.map((recipient) => ({ wallet: recipient.walletAddress, keyVersion: recipient.identity.version })) });
  if (Number(state.review.deadline) > 0) {
    if (state.preparation.evidenceSetHash !== batch.manifestHash || state.preparation.grantCommitment !== batch.grantCommitment) throw fail("On-chain access commitments differ from the stored batch");
    const operation = await require("../models/EvidenceOperation").findOne({ operationKey: `${batch.deploymentScope}:review-access:${batch.claimId}:${batch.claimVersion}` });
    if (operation) {
      const reconciled = await executeEvidenceOperation(`review-access:${batch.claimId}:${batch.claimVersion}`, () => { throw fail("A mined activation must retain its original signed transaction"); });
      if (reconciled.status !== "CONFIRMED") return;
    }
    batch.status = "ACTIVE"; await batch.save();
    for (const recipient of state.recipients) await notifyWallet(recipient.walletAddress, { type: "REVIEW_ACCESS_READY", title: `Claim #${batch.claimId}: review evidence ready`,
      message: "The fixed evidence set is available. The original voting deadline is active.", claimId: batch.claimId,
      link: `/auditor/vote/${batch.claimId}`, dedupeKey: `review-ready:${batch.deploymentScope}:${batch.claimId}:${batch.claimVersion}:${recipient.walletAddress}` });
    return;
  }
  if (state.review.finalized || Number((await state.manager.runner.getBlock("latest")).timestamp) > Number(state.preparation.deadline)) { batch.status = "EXPIRED"; await batch.save(); return; }
  if (!(await reviewState(batch.claimId)).ready) return;
  const result = await executeEvidenceOperation(`review-access:${batch.claimId}:${batch.claimVersion}`, async (signer) =>
    state.adjudicator.connect(signer).activateReview.populateTransaction(batch.claimId, batch.claimVersion, batch.manifestHash, batch.grantCommitment));
  if (result.status === "CONFIRMED") {
    batch.status = "ACTIVE"; await batch.save();
    for (const recipient of state.recipients) await notifyWallet(recipient.walletAddress, { type: "REVIEW_ACCESS_READY", title: `Claim #${batch.claimId}: review evidence ready`,
      message: "The owner has prepared access to the fixed evidence set. The voting deadline is now active.", claimId: batch.claimId,
      link: `/auditor/vote/${batch.claimId}`, dedupeKey: `review-ready:${batch.deploymentScope}:${batch.claimId}:${batch.claimVersion}:${recipient.walletAddress}` });
  }
}

async function resumeBatch(claimId, user) {
  const state = await reviewState(claimId);
  if (state.claim.claimantWallet.toLowerCase() !== user.walletAddress.toLowerCase()) throw fail("Only the owner may resume stored authorization", 403);
  const batch = await Batch.findOne({ deploymentScope: state.bundle?.deploymentScope, claimId: String(claimId), claimVersion: state.version });
  if (!batch) throw fail("No authorization batch was recorded");
  const entries = (await Batch.findById(batch._id).select("+grants")).grants;
  if (entries.some((entry) => !state.recipients.some((recipient) => recipient.walletAddress === entry.granteeWallet && recipient.identity?.version === entry.granteeKeyVersion))) throw fail("Restore the pinned reviewer identities; registered key rotation cannot reuse this batch");
  await Grant.updateMany({ deploymentScope: batch.deploymentScope, manifestHash: batch.manifestHash, claimId: batch.claimId,
    claimVersion: batch.claimVersion, ownerWallet: user.walletAddress.toLowerCase() }, { $set: { revokedAt: null } });
  batch.status = "PREPARED"; await batch.save();
  await activateBatch(batch);
  return statusFor(claimId, user);
}

let timer;
function startReviewAccessScheduler() {
  if (timer) return;
  let running = false;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { for (const batch of await Batch.find({ deploymentScope: await assertEvidenceDeployment(), status: "PREPARED" }).limit(50)) await activateBatch(batch); }
    catch { console.warn("Evidence access reconciliation will retry; voting remains contract-gated."); }
    finally { running = false; }
  }, 5000); timer.unref?.();
}
function stopReviewAccessScheduler() { if (timer) clearInterval(timer); timer = null; }
module.exports = { recipientIdentity, reviewState, statusFor, prepareBatch, resumeBatch, activateBatch, startReviewAccessScheduler, stopReviewAccessScheduler };
