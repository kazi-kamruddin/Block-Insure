const Attempt = require("../models/AppealSubmissionAttempt");
const File = require("../models/File");
const { getReadOnlyContract } = require("../services/contractService");
const { assertEvidenceDeployment, getBundle, MAX_REVIEW_FILES, fail } = require("../services/evidenceBundleService");
const { buildAppealCommitmentPayload, hashAppealCommitment } = require("../services/appealCommitmentService");
const { assertAppealFactsMatch } = require("../services/appealFactService");
const { registerConfirmedAppeal } = require("./appealController");

function cleanPayload(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) throw fail("An appeal payload is required", 422);
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== "string" || value.length > (key === "appealDescription" ? 8000 : 4000)) throw fail("Appeal fields must be bounded text", 422);
  }
  const payload = buildAppealCommitmentPayload(source);
  if (!/^[1-9]\d*$/.test(payload.claimId) || !payload.appealReason || payload.appealReason.length > 4000) throw fail("Valid claim and appeal reason required", 422);
  return payload;
}

async function ownedAttempt(id, user) {
  if (!/^[a-f0-9]{24}$/i.test(String(id))) throw fail("Invalid appeal attempt", 400);
  const attempt = await Attempt.findOne({ _id: id, deploymentScope: await assertEvidenceDeployment(), ownerWallet: user.walletAddress }).select("+payload");
  if (!attempt) throw fail("Appeal attempt not found", 404);
  return attempt;
}
const format = (attempt) => ({ id: String(attempt._id), claimId: attempt.claimId, claimVersion: attempt.claimVersion,
  status: attempt.status, payload: attempt.payload, appealReasonHash: attempt.appealReasonHash, transactionHash: attempt.transactionHash,
  lastRevertedTransactionHash: attempt.lastRevertedTransactionHash || "" });

const prepare = async (req, res, next) => {
  try {
    const payload = cleanPayload(req.body);
    const contract = getReadOnlyContract();
    const claim = await contract.getClaim(payload.claimId);
    if (claim.claimantWallet.toLowerCase() !== req.user.walletAddress) throw fail("Only the claimant may prepare an appeal", 403);
    if (Number(claim.status) !== 8) throw fail("The claim must be rejected before preparing an appeal");
    if ((payload.proposedHospitalId && payload.proposedHospitalId !== claim.hospitalId) ||
      (payload.proposedClaimType && payload.proposedClaimType !== claim.claimType)) throw fail("Hospital and treatment identity cannot change", 422);
    const key = { deploymentScope: await assertEvidenceDeployment(), claimId: payload.claimId, claimVersion: Number(await contract.claimVersion(payload.claimId)) + 1 };
    const bundle = await getBundle(payload.claimId, key.claimVersion - 1);
    if (!bundle) throw fail("Recover the existing evidence set before appealing");
    let attempt;
    try { attempt = await Attempt.findOneAndUpdate(key, { $setOnInsert: { ...key, ownerWallet: req.user.walletAddress, payload, startBlock: await contract.runner.getBlockNumber() } }, { upsert: true, returnDocument: "after" }).select("+payload"); }
    catch (error) { if (error.code !== 11000) throw error; attempt = await Attempt.findOne(key).select("+payload"); }
    if (attempt.status === "DRAFT") {
      const attachment = await File.findOne({ deploymentScope: key.deploymentScope, claimId: payload.claimId, claimVersion: key.claimVersion, documentType: "APPEAL_DOCUMENT", uploaderWallet: req.user.walletAddress });
      if (attachment) {
        attempt.payload = { ...attempt.payload, additionalDocumentHash: attachment.sha256Hash, additionalDocumentCID: attachment.ipfsCID };
        await attempt.save();
      }
    }
    res.status(201).json({ success: true, attempt: format(attempt) });
  } catch (error) { next(error); }
};

const ready = async (req, res, next) => {
  try {
    const attempt = await ownedAttempt(req.params.attemptId, req.user);
    const payload = cleanPayload(req.body);
    if (payload.claimId !== attempt.claimId) throw fail("Appeal claim changed");
    if (attempt.status !== "DRAFT") {
      if (attempt.appealReasonHash !== hashAppealCommitment(payload)) throw fail("A sealed appeal cannot be edited; resume its recorded payload");
      return res.json({ success: true, attempt: format(attempt) });
    }
    const contract = getReadOnlyContract();
    const claim = await contract.getClaim(attempt.claimId);
    if (Number(claim.status) !== 8 || Number(await contract.claimVersion(attempt.claimId)) + 1 !== attempt.claimVersion) throw fail("Claim version changed before appeal sealing");
    assertAppealFactsMatch(claim, payload);
    if (payload.additionalDocumentHash) {
      const previous = await getBundle(attempt.claimId, attempt.claimVersion - 1);
      if (previous.documentIds.length >= MAX_REVIEW_FILES) throw fail("The evidence set is full; use existing evidence or explicitly reduce the proposed attachment", 422);
      if (!await File.exists({ claimId: attempt.claimId, claimVersion: attempt.claimVersion, uploaderWallet: req.user.walletAddress,
        sha256Hash: payload.additionalDocumentHash.replace(/^0x/, ""), ipfsCID: payload.additionalDocumentCID })) throw fail("The appeal attachment is not an owned version-bound file");
    }
    attempt.payload = payload;
    attempt.appealReasonHash = hashAppealCommitment(payload);
    attempt.status = "READY";
    await attempt.save();
    res.json({ success: true, attempt: format(attempt) });
  } catch (error) { next(error); }
};

const recordTransaction = async (req, res, next) => {
  try {
    const attempt = await ownedAttempt(req.params.attemptId, req.user);
    const hash = req.body.transactionHash;
    if (typeof hash !== "string" || !/^0x[a-f0-9]{64}$/i.test(hash)) throw fail("Valid transaction hash required", 422);
    if (!["READY", "TX_SUBMITTED", "COMPLETED"].includes(attempt.status) || (attempt.transactionHash && attempt.transactionHash !== hash)) throw fail("Appeal operation cannot be rebound to another transaction");
    attempt.transactionHash = hash;
    if (attempt.status !== "COMPLETED") attempt.status = "TX_SUBMITTED";
    await attempt.save();
    res.json({ success: true, attempt: format(attempt) });
  } catch (error) { next(error); }
};

const reconcile = async (req, res, next) => {
  try {
    const attempt = await ownedAttempt(req.params.attemptId, req.user);
    if (!attempt.appealReasonHash) throw fail("Finish preparing the appeal before recovery");
    const contract = getReadOnlyContract();
    if (!attempt.transactionHash) {
      const latest = await contract.runner.getBlockNumber();
      if (latest - attempt.startBlock > 16000) throw fail("Appeal recovery requires an operator-assisted bounded receipt scan");
      for (let start = attempt.startBlock; start <= latest && !attempt.transactionHash; start += 2000) {
        const logs = await contract.queryFilter(contract.filters.ClaimAppealed(attempt.claimId, req.user.walletAddress), start, Math.min(latest, start + 1999));
        const matched = logs.find((event) => event.args.appealReasonHash.toLowerCase() === attempt.appealReasonHash.toLowerCase());
        if (matched) { attempt.transactionHash = matched.transactionHash; attempt.status = "TX_SUBMITTED"; await attempt.save(); }
      }
    }
    if (!attempt.transactionHash) return res.status(202).json({ success: false, pending: true, attempt: format(attempt), message: "No matching confirmed appeal yet; do not repeat an unresolved wallet request" });
    const receipt = await contract.runner.getTransactionReceipt(attempt.transactionHash);
    if (!receipt) return res.status(202).json({ success: false, pending: true, attempt: format(attempt) });
    if (Number(receipt.status) !== 1) {
      const transaction = await contract.runner.getTransaction(attempt.transactionHash);
      let parsed;
      try { parsed = contract.interface.parseTransaction(transaction); } catch { /* checked below */ }
      const expectedMethod = attempt.payload.additionalDocumentHash ? "submitAppealWithEvidence" : "submitAppeal";
      if (transaction?.from?.toLowerCase() !== req.user.walletAddress.toLowerCase() ||
        transaction?.to?.toLowerCase() !== String(contract.target).toLowerCase() ||
        parsed?.name !== expectedMethod || String(parsed.args[0]) !== attempt.claimId ||
        String(parsed.args[1]).toLowerCase() !== attempt.appealReasonHash.toLowerCase() ||
        (expectedMethod === "submitAppealWithEvidence" &&
          (String(parsed.args[2]).replace(/^0x/, "").toLowerCase() !== attempt.payload.additionalDocumentHash.replace(/^0x/, "").toLowerCase() ||
            parsed.args[3] !== attempt.payload.additionalDocumentCID))) throw fail("Failed transaction does not match the saved appeal", 403);
      const depth = (await contract.runner.getNetwork()).chainId === 31337n ? 1 : 12;
      if ((await contract.runner.getBlockNumber()) - receipt.blockNumber + 1 < depth ||
        (await contract.runner.getBlock(receipt.blockNumber))?.hash !== receipt.blockHash)
        return res.status(202).json({ success: false, pending: true, attempt: format(attempt), message: "Waiting for canonical confirmation of the failed transaction" });
      if (Number((await contract.getClaim(attempt.claimId)).status) !== 8 ||
        Number(await contract.claimVersion(attempt.claimId)) + 1 !== attempt.claimVersion) throw fail("Claim version changed; this saved appeal cannot be retried");
      attempt.lastRevertedTransactionHash = attempt.transactionHash;
      attempt.transactionHash = "";
      attempt.status = "READY";
      await attempt.save();
      return res.json({ success: false, retryable: true, attempt: format(attempt), message: "The saved appeal transaction reverted. Review the failure before explicitly submitting the same sealed appeal again." });
    }
    const result = await registerConfirmedAppeal({ ...attempt.payload, appealReasonHash: attempt.appealReasonHash, transactionHash: attempt.transactionHash }, req.user);
    if (result.appeal.claimVersion !== attempt.claimVersion) throw fail("The mined appeal version differs from this operation");
    attempt.status = "COMPLETED"; await attempt.save();
    res.json({ ...result, attempt: format(attempt) });
  } catch (error) { next(error); }
};

const list = async (req, res, next) => {
  try {
    const query = { deploymentScope: await assertEvidenceDeployment(), ownerWallet: req.user.walletAddress, status: { $ne: "COMPLETED" } };
    if (req.query.claimId !== undefined) { if (!/^[1-9]\d*$/.test(String(req.query.claimId))) throw fail("Invalid claim ID", 400); query.claimId = String(req.query.claimId); }
    res.json({ success: true, attempts: (await Attempt.find(query).sort({ createdAt: -1 }).limit(20).select("+payload")).map(format) });
  } catch (error) { next(error); }
};
module.exports = { prepare, ready, recordTransaction, reconcile, list };
