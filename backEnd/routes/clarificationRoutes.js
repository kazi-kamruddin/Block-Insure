const express = require("express");
const { ethers } = require("ethers");
const Clarification = require("../models/ClaimClarification");
const Episode = require("../models/MockHospitalRecord");
const File = require("../models/File");
const bundles = require("../services/evidenceBundleService");
const { getReadOnlyContract, getAdminContract } = require("../services/contractService");
const auth = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const router = express.Router({ mergeParams: true });
const extension = ["function clarificationUsed(uint256) view returns(bool)",
  "function clarificationEvidence(uint256,uint64) view returns(bytes32)"];
router.use(auth);
router.use(async (req, res, next) => {
  try {
    const manager = getReadOnlyContract();
    const { claimId } = req.params;
    const claim = await manager.getClaim(claimId);
    const owner = claim.claimantWallet.toLowerCase();
    if (!["ADMIN", "CLAIM_OFFICER"].includes(req.user.role) && owner !== req.user.walletAddress.toLowerCase()) throw bundles.fail("Claim access denied", 403);
    const [address, scope, version, block] = await Promise.all([manager.claimAdjudicator(), bundles.assertEvidenceDeployment(),
      manager.claimVersion(claimId), manager.runner.provider.getBlock("latest")]);
    const panel = new ethers.Contract(address, extension, manager.runner);
    const record = await Clarification.findOne({ scope, claimId });
    req.clarification = { claimId, owner, scope, manager, panel, record, claim, version: Number(version), now: Number(block.timestamp) };
    res.set("Cache-Control", "private, no-store");
    next();
  } catch (error) { next(error); }
});
router.get("/", async (req, res, next) => {
  try {
    const { record, panel, claimId, claim, manager, now } = req.clarification;
    if (!record) {
      let available = false;
      if (Number(claim.status) === 5 && Number(await manager.manualReviewEligibleAt(claimId)) > now + 2) {
        try { available = !await panel.clarificationUsed(claimId); }
        catch (error) { if (error.code !== "CALL_EXCEPTION") throw error; }
      }
      return res.json({ available });
    }
    const active = req.clarification.version === record.priorVersion && Number(claim.status) === 5 && now <= record.deadline;
    const [uploaded, confirmedHash] = await Promise.all([
      File.exists({ deploymentScope: record.scope, claimId, claimVersion: record.priorVersion + 1, uploaderWallet: record.owner, documentType: "CLARIFICATION_DOCUMENT" }),
      record.manifestHash && !record.confirmed ? panel.clarificationEvidence(claimId, record.priorVersion + 1) : null,
    ]);
    res.json({ question: record.question, deadline: record.deadline, priorVersion: record.priorVersion,
      confirmed: record.confirmed, canAnswer: active, uploaded: Boolean(uploaded),
      canReconcile: Boolean(confirmedHash && confirmedHash === record.manifestHash) });
  } catch (error) { next(error); }
});
router.post("/open", requireRole("ADMIN", "CLAIM_OFFICER"), async (req, res, next) => {
  try {
    const { manager, panel, scope, claim, claimId, owner, version, now, record } = req.clarification;
    const question = req.body.question;
    if (typeof question !== "string" || !question.trim() || question.length > 500) throw bundles.fail("Supply a specific evidence question", 422);
    const deadline = Number(await manager.manualReviewEligibleAt(claimId)) - 1;
    if (record || Number(claim.status) !== 5 || deadline <= now || await panel.clarificationUsed(claimId)) throw bundles.fail("Clarification window unavailable");
    await Clarification.create({ scope, claimId, owner, priorVersion: version, question: question.trim(),
      deadline, requestedBy: req.user.walletAddress });
    res.status(201).json({ deadline });
  } catch (error) { next(error.code === 11000 ? bundles.fail("A request already exists") : error); }
});
router.post("/authorize", async (req, res, next) => {
  try {
    const { owner, claim, claimId, scope, manager, panel, now, version, record } = req.clarification;
    if (owner !== req.user.walletAddress.toLowerCase() || !record || Number(claim.status) !== 5 ||
        version !== record.priorVersion || now > record.deadline) throw bundles.fail("Clarification unavailable");
    const source = await Episode.findOne({ invoiceHash: claim.invoiceHash, authorizedClaimants: owner,
      publicationPending: { $ne: true }, recordStatus: "VALID", invoiceStatus: "VALID", licenseStatus: "ACTIVE" }).lean();
    if (!source || source.hospitalId !== claim.hospitalId || source.treatmentType !== claim.claimType) throw bundles.fail("Verified episode unavailable");
    const incidentDay = new Date((Number(claim.incidentDate) + 21600) * 1000).toISOString().slice(0, 10);
    if (incidentDay < source.admissionDate.toISOString().slice(0, 10) || incidentDay > source.dischargeDate.toISOString().slice(0, 10)) throw bundles.fail("Episode dates changed");
    const previous = await bundles.getBundle(claimId, version);
    const additional = await File.findOne({ deploymentScope: scope, claimId, claimVersion: version + 1, uploaderWallet: owner, documentType: "CLARIFICATION_DOCUMENT" });
    if (!additional || !previous) throw bundles.fail("A sealed original and encrypted supplement are required");
    const original = JSON.parse(previous.manifest).insurerStatement;
    if (!original) throw bundles.fail("This claim has no issued episode statement");
    const ids = [...previous.documentIds, String(additional._id)];
    const files = await File.find({ _id: { $in: ids } });
    const documents = ids.map(id => files.find(file => String(file._id) === id));
    if (documents.some(file => !file)) throw bundles.fail("Evidence unavailable");
    const amount = ethers.parseEther(source.billAmount);
    const statement = { ...original, revision: source.sourceRevision || 0, grossWei: String(amount),
      admission: source.admissionDate.toISOString(), discharge: source.dischargeDate.toISOString() };
    const { manifestHash } = bundles.buildManifest({ deploymentScope: scope, claimId, claimVersion: version + 1, documents, insurerStatement: statement });
    const saved = await Clarification.updateOne({ _id: record._id, confirmed: false, $or: [{ manifestHash: null }, { manifestHash }] },
      { $set: { manifestHash, statement, documentIds: ids } });
    if (!saved.matchedCount) throw bundles.fail("This response was already sealed with different evidence");
    const chain = (await manager.runner.provider.getNetwork()).chainId;
    const digest = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256","address","address","uint256","uint64","uint64","uint256","bytes32"],
      [chain, panel.target, owner, claimId, version, record.deadline, amount, manifestHash]));
    const signature = await getAdminContract().runner.signMessage(ethers.getBytes(digest));
    res.json({ panel: panel.target, args: [claimId, version, record.deadline, String(amount), manifestHash, signature] });
  } catch (error) { next(error); }
});
router.post("/reconcile", async (req, res, next) => {
  try {
    const { claimId, panel, record, owner } = req.clarification;
    if (!record?.manifestHash || await panel.clarificationEvidence(claimId, record.priorVersion + 1) !== record.manifestHash) throw bundles.fail("Response is awaiting on-chain confirmation");
    const files = await File.find({ _id: { $in: record.documentIds } });
    const documents = record.documentIds.map(id => files.find(file => String(file._id) === id));
    if (documents.some(file => !file)) throw bundles.fail("Evidence unavailable");
    const bundle = await bundles.sealBundle({ claimId, claimVersion: record.priorVersion + 1, ownerWallet: owner, documents, insurerStatement: record.statement });
    if (bundle.manifestHash !== record.manifestHash) throw bundles.fail("Registered evidence differs from the confirmed response");
    await Clarification.updateOne({ _id: record._id }, { $set: { confirmed: true } });
    res.json({ confirmed: true });
  } catch (error) { next(error); }
});
module.exports = router;
