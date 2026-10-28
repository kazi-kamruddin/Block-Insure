const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");
const { ethers } = require("ethers");
const contracts = require("../services/contractService");
const load = require("./helpers/loadIsolatedModule");
const { executeEvidenceOperation } = require("../services/evidenceOperationService");
const Operation = require("../models/EvidenceOperation");
const { appendEvidenceEvent, createSignedTreeHead } = require("../services/evidenceTransparencyService");
const { anchorCurrentEvidenceTree } = require("../services/evidenceAnchorService");
const { assertEvidenceDeployment, sealBundle } = require("../services/evidenceBundleService");
const Head = require("../models/EvidenceTreeHead");
const File = require("../models/File");
const Bundle = require("../models/EvidenceBundle");
const Submission = require("../models/ClaimSubmissionAttempt");
let provider, admin, registry;
test.before(async () => {
  const uri = new URL(process.env.MONGODB_URI);
  assert.ok(["localhost", "127.0.0.1"].includes(uri.hostname) && /^\/block_insure_[a-z0-9_]*e2e$/.test(uri.pathname));
  provider = new ethers.JsonRpcProvider(process.env.RPC_URL, 31337, { staticNetwork: true, cacheTimeout: -1 });
  assert.equal((await provider.getNetwork()).chainId, 31337n);
  admin = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);
  registry = contracts.getEvidenceRegistry(admin);
  await mongoose.connect(process.env.MONGODB_URI);
  await Promise.all([Operation.init(), Head.init(), File.init(), Bundle.init()]);
  await assertEvidenceDeployment();
});
test.after(async () => { await mongoose.disconnect(); provider?.destroy(); });

test("lost acknowledgement is recovered by a fresh process with the identical signed transaction", async () => {
  const faultyProvider = new Proxy(provider, { get(target, key) {
    if (key === "getTransactionReceipt") return async () => null;
    if (key === "broadcastTransaction") return async (raw) => { await target.broadcastTransaction(raw); throw new Error("lost acknowledgement"); };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  const signer = admin.connect(faultyProvider);
  const operation = await executeEvidenceOperation("restart-probe", async () => registry.setTreeHeadSigner.populateTransaction(admin.address), signer);
  assert.equal(operation.status, "PENDING");
  assert.match(operation.transactionHash, /^0x[0-9a-f]{64}$/);
  const child = spawnSync(process.execPath, ["-e", `
    const mongoose=require('mongoose');
    const {executeEvidenceOperation}=require('./services/evidenceOperationService');
    (async()=>{await mongoose.connect(process.env.MONGODB_URI);let result;
      for(let n=0;n<20;n++){result=await executeEvidenceOperation('restart-probe',()=>{throw Error('Must reuse signed bytes')});if(result.status==='CONFIRMED')break;await new Promise(r=>setTimeout(r,150));}
      console.log(JSON.stringify({status:result.status,hash:result.transactionHash}));await mongoose.disconnect();process.exit(0);
    })().catch(()=>process.exit(1));
  `], { cwd: path.resolve(__dirname, ".."), env: process.env, encoding: "utf8", windowsHide: true, timeout: 20000 });
  assert.equal(child.status, 0, "Fresh process reconciles persisted operation");
  const recovered = JSON.parse(child.stdout.trim());
  assert.equal(recovered.status, "CONFIRMED"); assert.equal(recovered.hash, operation.transactionHash);
  assert.equal(await Operation.countDocuments({ operationKey: operation.operationKey }), 1);
});

test("concurrent evidence operations for one key share one persisted transaction", async () => {
  const populate = async () => registry.setTreeHeadSigner.populateTransaction(admin.address);
  const operations = await Promise.all([executeEvidenceOperation("concurrency-probe", populate, admin), executeEvidenceOperation("concurrency-probe", populate, admin)]);
  assert.equal(String(operations[0]._id), String(operations[1]._id));
  for (let n = 0; n < 20; n++) { if ((await executeEvidenceOperation("concurrency-probe", populate, admin)).status === "CONFIRMED") break; await new Promise((r) => setTimeout(r, 150)); }
  assert.equal((await Operation.findById(operations[0]._id)).status, "CONFIRMED");
});

test("an unanchored signed predecessor followed by new evidence recovers in order", async () => {
  await appendEvidenceEvent({ idempotencyKey: "anchor-first", eventType: "TEST_RECOVERY", claimId: "9101", claimVersion: 1, actorWallet: admin.address });
  const first = await createSignedTreeHead();
  const fault = load("services/evidenceAnchorService.js", { "./evidenceOperationService": { executeEvidenceOperation: async () => { throw new Error("injected RPC loss before anchor"); } } }, process.env);
  await assert.rejects(fault.anchorCurrentEvidenceTree(), /injected RPC/);
  await appendEvidenceEvent({ idempotencyKey: "anchor-second", eventType: "TEST_RECOVERY", claimId: "9102", claimVersion: 1, actorWallet: admin.address });
  const second = await createSignedTreeHead();
  assert.equal(second.previousRootHash, first.rootHash);
  for (let n = 0; n < 30 && await Head.countDocuments({ anchorVerified: false }); n++) { await anchorCurrentEvidenceTree(); await new Promise((r) => setTimeout(r, 150)); }
  assert.equal(Number(await registry.currentTreeSize()), second.treeSize);
  for (const head of [first, second]) {
    const stored = await Head.findById(head._id);
    assert.equal(stored.anchorVerified, true);
    assert.equal((await registry.getTreeHead(head.treeSize)).rootHash.toLowerCase(), `0x${head.rootHash}`);
    assert.equal((await provider.getTransactionReceipt(stored.anchorTransactionHash)).status, 1);
  }
  await anchorCurrentEvidenceTree();
  assert.equal(await Head.countDocuments(), 2);
});

test("sealed sets are immutable and versioned while retaining original encrypted-file identities", async () => {
  const scope = await assertEvidenceDeployment();
  const documents = [];
  for (let index = 0; index < 2; index++) documents.push(await File.create({ deploymentScope: scope, claimId: "9201", claimVersion: 1,
    uploaderWallet: admin.address.toLowerCase(), originalName: `synthetic-${index}.pdf`, mimeType: "application/octet-stream",
    sha256Hash: ethers.id(`file-${index}`).slice(2), ipfsCID: `synthetic-cid-${index}`, encrypted: true, documentType: index ? "SUPPORTING_DOCUMENT" : "HOSPITAL_BILL" }));
  const args = { claimId: "9201", claimVersion: 1, ownerWallet: admin.address.toLowerCase(), documents };
  const initial = await sealBundle(args);
  assert.equal((await sealBundle(args)).manifestHash, initial.manifestHash);
  await assert.rejects(sealBundle({ ...args, documents: [documents[0]] }), /different sealed/);
  const next = await sealBundle({ ...args, claimVersion: 2 });
  assert.notEqual(next.manifestHash, initial.manifestHash);
  assert.deepEqual(next.documentIds, initial.documentIds);
  assert.equal((await File.findById(documents[0]._id)).claimVersion, 1);
});

test("a different deployment scope cannot reuse the evidence database", async () => {
  const binding = mongoose.connection.collection("evidence_deployment_binding");
  const original = await binding.findOne({ _id: "binding" });
  try {
    await binding.updateOne({ _id: "binding" }, { $set: { deploymentScope: "another-deployment" } });
    await assert.rejects(assertEvidenceDeployment(), /another deployment/);
  } finally { await binding.updateOne({ _id: "binding" }, { $set: { deploymentScope: original.deploymentScope } }); }
});

test("a mined claim whose transaction registration was lost is discovered and finalized without resubmission", async () => {
  const { getSubmissionAttempt, reconcileClaimSubmission } = require("../controllers/claimController");
  const holder = new ethers.Wallet(process.env.E2E_USER_PRIVATE_KEY, provider);
  const manager = contracts.getReadOnlyContract().connect(holder);
  const packageInfo = await manager.getPolicyPackage(1);
  const policyId = await manager.policyCounter();
  await (await manager.purchasePolicy(1, { value: packageInfo.premiumAmount })).wait();
  const policy = await manager.getPolicy(policyId);
  const invoiceHash = ethers.id("unregistered-transaction-test-invoice");
  const facts = { incidentDate: String(policy.startDate), claimType: "HOSPITALIZATION", claimAmountWei: ethers.parseEther("0.1").toString(), hospitalId: "HOSP-001", invoiceHash };
  const attempt = await Submission.create({ deploymentScope: await assertEvidenceDeployment(), walletAddress: holder.address.toLowerCase(), policyId: String(policyId),
    expectedEvidenceCount: 1, startBlock: await provider.getBlockNumber(), submittedFacts: facts, status: "UPLOADING", uploadLeaseUntil: new Date(0) });
  const file = await File.create({ deploymentScope: attempt.deploymentScope, attemptId: String(attempt._id), uploadSlot: 0, encryptedBytes: 100,
    envelopeClaimId: `attempt:${attempt._id}`, claimVersion: 1, uploaderWallet: holder.address.toLowerCase(), originalName: "synthetic-encrypted-commitment.pdf", mimeType: "application/octet-stream",
    sha256Hash: ethers.id("synthetic-ciphertext-commitment").slice(2), ipfsCID: "synthetic-recovery-claim-cid", documentType: "HOSPITAL_BILL", encrypted: true });
  const req = { params: { attemptId: String(attempt._id) }, user: { walletAddress: holder.address.toLowerCase(), role: "USER" } };
  let response;
  const res = { status() { return this; }, json(body) { response = body; return this; } };
  const next = (error) => { throw error; };
  await getSubmissionAttempt(req, res, next);
  assert.equal(response.attempt.status, "UPLOADED", "A stored file repairs its interrupted attempt bookkeeping");
  await Submission.updateOne({ _id: attempt._id }, { $set: { sealedAt: new Date(), expiresAt: null } });
  const transaction = await manager.submitClaim(policyId, BigInt(facts.claimAmountWei), policy.startDate, facts.claimType, facts.hospitalId, invoiceHash, `0x${file.sha256Hash}`, file.ipfsCID);
  await transaction.wait();
  const countBefore = await manager.claimCounter();
  await reconcileClaimSubmission(req, res, next);
  assert.equal(response.attempt.status, "COMPLETED");
  assert.equal(response.attempt.transactionHash, transaction.hash);
  const finished = await Submission.findById(attempt._id);
  assert.ok(await Bundle.findOne({ claimId: finished.claimId, claimVersion: 1 }));
  await reconcileClaimSubmission(req, res, next);
  assert.equal(await manager.claimCounter(), countBefore);
  assert.equal(await Bundle.countDocuments({ claimId: finished.claimId, claimVersion: 1 }), 1);
});
