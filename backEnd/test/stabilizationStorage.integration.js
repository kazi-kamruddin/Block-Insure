const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { ethers } = require("ethers");
const load = require("./helpers/loadIsolatedModule");
const Primary = require("../models/MockHospitalRecord");
const Secondary = require("../models/MockHospitalRecordOracle2");
const Publication = require("../models/RegistryPublication");
const Chunk = require("../models/RegistrySnapshotChunk");
const File = require("../models/File");
const EvidenceEvent = require("../models/EvidenceEvent");
const IndexedEvent = require("../models/IndexedBlockchainEvent");
const IndexedBlock = require("../models/IndexedBlock");
const Checkpoint = require("../models/IndexerCheckpoint");
const merkle = require("../services/merkleRegistryService");
const { finalizeEvidence } = require("../services/evidenceFinalizationService");
let databaseName;
test.before(async () => {
  if (!process.env.E2E_MONGODB_URI) throw new Error("Prepare a local MongoDB and set E2E_MONGODB_URI before storage tests.");
  const uri = new URL(process.env.E2E_MONGODB_URI);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(uri.hostname)) throw new Error("Storage tests require local MongoDB");
  databaseName = `stabilization_storage_${Date.now()}_test`;
  uri.pathname = `/${databaseName}`;
  await mongoose.connect(uri.toString());
  await Promise.all([Primary, Secondary, Publication, Chunk, File, EvidenceEvent, IndexedEvent, IndexedBlock, Checkpoint].map((model) => model.init()));
});
test.after(async () => {
  if (mongoose.connection.name === databaseName && /^stabilization_storage_\d+_test$/.test(databaseName)) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const record = (invoice) => ({
  hospitalId: "HOSP-001", patientHash: ethers.id(`patient-${invoice}`),
  authorizedClaimants: [`0x${"1".repeat(40)}`], treatmentType: "HOSPITALIZATION", diagnosisCode: "DEMO",
  admissionDate: new Date("2026-10-01"), dischargeDate: new Date("2026-10-02"), invoiceDate: new Date("2026-10-02"),
  billAmount: "0.1", expectedBillMin: "0.01", expectedBillMax: "1", invoiceNumber: invoice, invoiceHash: ethers.id(invoice),
  invoiceStatus: "VALID", recordStatus: "VALID", licenseStatus: "ACTIVE", publicationPending: true,
});

test("publication mirrors both collections and preserves pinned historical proofs", async () => {
  let count = 0;
  const publisher = load("services/registryPublicationService.js", {
    "./contractService": {
      getAdminContract: () => ({ runner: { provider: {} } }),
      getOracleCoordinator: async () => ({ publishRegistrySnapshot: async () => ({ hash: `0x${String(++count).padStart(64, "0")}`, wait: async () => ({ status: 1 }) }) }),
    },
  });
  await Primary.create({ ...record("one"), identityVersion: 2 });
  await publisher.queueRegistryPublication();
  const first = await publisher.publishPendingRegistry();
  assert.equal(first.status, "PUBLISHED");
  assert.equal((await merkle.getCachedRegistryTree()).rootHash, first.rootHash);
  assert.equal(await Primary.countDocuments({ publicationPending: true }), 0);
  await Primary.updateOne({ invoiceNumber: "one" }, { $set: { billAmount: "0.2", publicationPending: true } });
  await Primary.create(record("two"));
  // A stale derived-only invoice must not wedge publication indefinitely.
  await Secondary.create(record("orphaned-secondary"));
  // No job is queued: emulate a crash between the source write and job creation.
  const second = await publisher.publishPendingRegistry();
  assert.notEqual(second.rootHash, first.rootHash);
  assert.equal(merkle.buildMerkleTree(await Primary.find().lean()).rootHash, merkle.buildMerkleTree(await Secondary.find().lean()).rootHash);
  assert.equal(await Secondary.countDocuments({ invoiceNumber: "orphaned-secondary" }), 0);
  const oldProof = await merkle.buildRegistryMerkleProof({ invoiceHash: ethers.id("one"), rootHash: first.rootHash });
  const newProof = await merkle.buildRegistryMerkleProof({ invoiceHash: ethers.id("one"), rootHash: second.rootHash, registrySnapshot: "oracle2" });
  assert.equal(oldProof.canonicalRecord.billAmount, "0.1");
  assert.equal(newProof.canonicalRecord.billAmount, "0.2");
  assert.equal(merkle.verifyMerkleProof(oldProof), true);
  assert.equal(merkle.verifyMerkleProof(newProof), true);
  // Recovery after an out-of-band invoice rename must retain the archived root.
  await Primary.updateOne({ invoiceNumber: "two" }, { $set: { invoiceNumber: "renamed-two", invoiceHash: ethers.id("renamed-two"), publicationPending: true } });
  const third = await publisher.publishPendingRegistry();
  assert.equal(third.status, "PUBLISHED");
  assert.equal(await Secondary.countDocuments({ invoiceHash: ethers.id("two") }), 0);
  assert.equal(merkle.verifyMerkleProof(await merkle.buildRegistryMerkleProof({ invoiceHash: ethers.id("two"), rootHash: second.rootHash })), true);
});

test("publication resumes an already mined transaction without sending it twice", async () => {
  let calls = 0;
  let confirmed = false;
  const dependencies = { "./contractService": {
    getAdminContract: () => ({ runner: { provider: { getTransactionReceipt: async () => confirmed ? { status: 1 } : null } } }),
    getOracleCoordinator: async () => ({ publishRegistrySnapshot: async () => { calls++; return { hash: `0x${"a".repeat(64)}`, wait: async () => { throw new Error("lost receipt response"); } }; } }),
  } };
  const publisher = load("services/registryPublicationService.js", dependencies);
  await Primary.updateOne({ invoiceNumber: "renamed-two" }, { $set: { publicationPending: true } });
  await publisher.queueRegistryPublication();
  await assert.rejects(publisher.publishPendingRegistry(), /lost receipt/);
  confirmed = true;
  const restarted = load("services/registryPublicationService.js", dependencies);
  assert.equal((await restarted.publishPendingRegistry()).status, "PUBLISHED");
  assert.equal(await Primary.countDocuments({ publicationPending: true }), 0);
  assert.equal(await restarted.publishPendingRegistry(), null);
  assert.equal(calls, 1);
});

test("evidence finalization recovers a crash after append and handles concurrent retries once", async () => {
  const attempt = { _id: new mongoose.Types.ObjectId(), policyId: "1" };
  const file = await File.create({ uploaderWallet: `0x${"1".repeat(40)}`, originalName: "demo.enc", mimeType: "application/octet-stream", sha256Hash: "b".repeat(64), ipfsCID: "demo-ciphertext", documentType: "HOSPITAL_BILL", envelopeClaimId: `attempt:${attempt._id}`, claimVersion: 1 });
  attempt.documentId = file.id;
  const claim = { claimId: 123n, policyId: 1n, documentHash: `0x${file.sha256Hash}`, documentCID: file.ipfsCID };
  const parameters = { file, claim, attempt, version: 1, actorWallet: file.uploaderWallet };
  const save = file.save.bind(file);
  let saves = 0;
  file.save = async () => { if (++saves === 2) throw new Error("crash after event append"); return save(); };
  await assert.rejects(finalizeEvidence(parameters), /crash after event append/);
  assert.equal(await EvidenceEvent.countDocuments({ documentId: file.id }), 1);
  await Promise.all([1, 2].map(async () => finalizeEvidence({ ...parameters, file: await File.findById(file.id) })));
  const restored = await File.findById(file.id);
  assert.equal(restored.claimId, "123");
  assert.equal(restored.evidenceEventIndex, 0);
  assert.equal(await EvidenceEvent.countDocuments({ documentId: file.id }), 1);
});

test("evidence retry reuses a legacy addition receipt without rewriting the transparency log", async () => {
  const { appendEvidenceEvent } = require("../services/evidenceTransparencyService");
  const documentId = new mongoose.Types.ObjectId();
  const event = { eventType: "EVIDENCE_ADDED", documentId, claimId: "456", claimVersion: 1, actorWallet: `0x${"1".repeat(40)}` };
  const legacy = await appendEvidenceEvent(event);
  const retried = await appendEvidenceEvent({ ...event, idempotencyKey: `evidence-added:${documentId}:1` });
  assert.equal(retried.treeIndex, legacy.treeIndex);
  assert.equal(retried.leafHash, legacy.leafHash);
  assert.equal(await EvidenceEvent.countDocuments({ documentId }), 1);
});

test("real MongoDB indexer replay repairs partial batches and scopes uniqueness", async () => {
  const address = `0x${"5".repeat(40)}`;
  const iface = new ethers.Interface(require("../abi/InsuranceManager.json").abi);
  const encoded = iface.encodeEventLog(iface.getEvent("ClaimSubmitted"), [1n, 1n, address, 10n]);
  const provider = {
    getNetwork: async () => ({ chainId: 31337n }), getBlockNumber: async () => 2,
    getBlock: async (number) => ({ number, hash: `block-${number}`, parentHash: `block-${number - 1}` }),
    getLogs: async () => [1, 2].map((number) => ({ ...encoded, address, index: 0, transactionHash: `tx-${number}`, blockNumber: number, blockHash: `block-${number}` })),
  };
  let writes = 0, crash = true;
  const events = Object.create(IndexedEvent);
  events.updateOne = async (...args) => { if (crash && ++writes === 2) throw new Error("partial persistence"); return IndexedEvent.updateOne(...args); };
  const service = load("services/blockchainIndexerService.js", {
    ethers: { ethers: { ...ethers, Contract: class { async oracleCoordinator() { return `0x${"2".repeat(40)}`; } async claimAdjudicator() { return `0x${"3".repeat(40)}`; } async policyEconomics() { return `0x${"4".repeat(40)}`; } } } },
    "./contractService": { getProvider: () => provider, getContractAddress: () => address },
    "../models/IndexedBlockchainEvent": events,
  });
  await IndexedEvent.collection.createIndex({ contractAddress: 1, transactionHash: 1, logIndex: 1 }, { unique: true });
  await service.ensureIndexerIndexes();
  await assert.rejects(service.indexConfirmedEvents(), /partial persistence/);
  assert.equal(await Checkpoint.countDocuments(), 0);
  crash = false;
  await service.indexConfirmedEvents();
  assert.equal(await IndexedEvent.countDocuments(), 2);
  const sample = (await IndexedEvent.findOne().lean());
  delete sample._id;
  await IndexedEvent.create({ ...sample, indexerId: "another-deployment" });
  assert.equal(await IndexedEvent.countDocuments(), 3);
});

test("read projections replay interrupted snapshots and reuse unchanged entities", async () => {
  const Snapshot = require("../models/ChainReadSnapshot");
  await Snapshot.init();
  const scope = "projection-integration";
  let blockNumber = 1, reads = 0, fail = false, branch = "canonical";
  const provider = { getBlock: async (number) => ({ hash: `${branch}-${number}`, timestamp: 100 }) };
  const result = (value) => ({ toObject: () => value });
  const manager = { target: `0x${"7".repeat(40)}`, runner: { provider },
    getClaim: async () => { reads++; return result({ claimId: 1n, policyId: 1n, claimAmount: 20n, status: BigInt(blockNumber) }); },
    calculateSettlement: async () => result({ claimAmount: 20n, insurerPays: 15n }),
  };
  const benefits = { getBenefitRequest: async () => result({ requestId: 1n, policyId: 1n, packageId: 1n, benefitType: 0n, status: 2n, amount: 10n }) };
  const snapshots = Object.create(Snapshot);
  snapshots.updateOne = async (...args) => { if (fail) throw new Error("interrupted projection"); return Snapshot.updateOne(...args); };
  const service = load("services/chainReadProjectionService.js", {
    "./blockchainIndexerService": { getIndexerContext: async () => ({ indexerId: scope }), indexConfirmedEvents: async () => {} },
    "./contractService": { getReadOnlyContract: () => manager, getPolicyEconomics: async () => ({ getPolicyTerms: async () => result({ insurerShareBps: 7500n }) }) },
    "../models/ChainReadSnapshot": snapshots,
    "./policyBenefitsService": { getReadOnlyBenefitsContract: () => benefits },
  });
  const checkpoint = () => Checkpoint.findOneAndUpdate({ indexerId: scope }, { contractAddress: manager.target, blockNumber, blockHash: `${branch}-${blockNumber}` }, { upsert: true });
  const event = () => IndexedEvent.create({ indexerId: scope, contractAddress: manager.target, contractName: "InsuranceManager", blockNumber, blockHash: `${branch}-${blockNumber}`, transactionHash: `project-tx-${branch}-${blockNumber}`, logIndex: 0, eventName: "ClaimSubmitted", args: { claimId: "1" } });
  await checkpoint(); await event();
  assert.equal((await service.readEntities("claim"))[0].status, 1n);
  await service.readEntities("claim"); assert.equal(reads, 1);
  blockNumber = 2; await checkpoint(); await event(); fail = true;
  await assert.rejects(service.readEntities("claim"), /interrupted projection/);
  assert.equal((await Checkpoint.findOne({ indexerId: `read:v2:${scope}` })).blockNumber, 1);
  fail = false;
  assert.equal((await service.readEntities("claim"))[0].status, 2n);
  // Model the raw indexer's completed canonical replay before derived reads.
  branch = "replacement"; blockNumber = 1;
  await IndexedEvent.deleteMany({ indexerId: scope });
  await checkpoint(); await event();
  assert.equal((await service.readEntities("claim"))[0].status, 1n);
  assert.equal(await Snapshot.countDocuments({ indexerId: `read:v2:${scope}`, blockHash: /^canonical-/ }), 0);
  assert.equal((await Checkpoint.findOne({ indexerId: `read:v2:${scope}` })).blockHash, "replacement-1");
  blockNumber = 2; await checkpoint();
  await IndexedEvent.create({ indexerId: scope, contractAddress: manager.target, contractName: "PolicyBenefitsManager", blockNumber, blockHash: `${branch}-${blockNumber}`, transactionHash: "benefit-created", logIndex: 0, eventName: "BenefitApproved", args: { requestId: "1" } });
  const benefit = (await service.readEntities("benefit"))[0];
  assert.equal(benefit.requestId, 1n); assert.equal(benefit.amount, 10n);
});

test("email verification uses durable limits, one-use challenges and a current profile binding", async () => {
  const User = require("../models/User"), Challenge = require("../models/EmailChallenge"), Slot = require("../models/OtpDeliverySlot");
  await Promise.all([User.init(), Challenge.init(), Slot.init()]);
  const walletAddress = `0x${"b".repeat(40)}`;
  await User.create({ walletAddress, email: "prototype@example.test" });
  let otp, fail = false, mode = "brevo";
  const service = load("services/emailVerificationService.js", { "./otpDeliveryService": {
    deliveryMode: () => mode,
    deliverOtp: async (input) => { otp = input.otp; if (fail) throw new Error("Delivery failed"); return { deliveryMode: mode }; },
  } }, { BANK_OTP_SECRET: "isolated-test-only-secret" });
  const request = await service.requestVerification(walletAddress);
  await assert.rejects(service.requestVerification(walletAddress), (error) => error.statusCode === 429);
  const confirmations = await Promise.allSettled([service.confirmVerification(walletAddress, request.challengeId, otp), service.confirmVerification(walletAddress, request.challengeId, otp)]);
  assert.equal(confirmations.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(confirmations.find((result) => result.status === "fulfilled").value.verified, true);
  assert.equal((await User.findOne({ walletAddress }).select("+verifiedEmail")).verifiedEmail, "prototype@example.test");
  await assert.rejects(service.confirmVerification(walletAddress, request.challengeId, otp), /expired, used/);
  await Slot.deleteMany({});
  const changed = await service.requestVerification(walletAddress);
  let saved;
  const response = { status: () => response, json: (body) => { saved = body; } };
  await require("../controllers/userController").registerUser({ user: { walletAddress }, body: { email: "changed@example.test", name: "Synthetic profile", phone: "" } }, response, (error) => { throw error; });
  assert.deepEqual(Object.keys(saved.user).sort(), ["email", "name", "phone", "role", "walletAddress"]);
  const edited = await User.findOne({ walletAddress }).select("+verifiedEmail");
  assert.equal(Boolean(edited.verifiedEmail), false); assert.equal(Boolean(edited.emailVerifiedAt), false);
  await assert.rejects(service.confirmVerification(walletAddress, changed.challengeId, otp), /profile email changed/);
  await Slot.deleteMany({}); mode = "simulation";
  const simulated = await service.requestVerification(walletAddress);
  mode = "brevo";
  assert.equal((await service.confirmVerification(walletAddress, simulated.challengeId, otp)).verified, false);
  await Slot.deleteMany({}); fail = true;
  await assert.rejects(service.requestVerification(walletAddress), /Delivery failed/);
  assert.equal(await Challenge.countDocuments({ walletAddress, status: "PENDING" }), 0);
  await Slot.deleteMany({}); fail = false;
  const locked = await service.requestVerification(walletAddress);
  const wrong = otp === "000000" ? "000001" : "000000";
  for (let attempt = 0; attempt < 3; attempt++) await assert.rejects(service.confirmVerification(walletAddress, locked.challengeId, wrong), /Incorrect code/);
  await assert.rejects(service.confirmVerification(walletAddress, locked.challengeId, otp), /expired, used/);
  assert.equal((await Challenge.findOne({ challengeId: locked.challengeId })).status, "LOCKED");
  await Slot.deleteMany({});
  await Slot.create({ _id: `wallet:${walletAddress}`, count: 10, nextAllowedAt: new Date(Date.now() - 1000), windowStart: new Date() });
  await assert.rejects(service.reserveDelivery(walletAddress, "changed@example.test"), (error) => error.statusCode === 429);
  await Slot.updateOne({ _id: `wallet:${walletAddress}` }, { windowStart: new Date(Date.now() - 86401000) });
  await service.reserveDelivery(walletAddress, "changed@example.test");
  assert.equal((await Slot.findById(`wallet:${walletAddress}`)).count, 1);
  await Slot.updateOne({ _id: "application:otp-email" }, { count: 100 });
  await assert.rejects(service.reserveDelivery("different-test-wallet", "different@example.test"), (error) => error.statusCode === 429);
});

test("premium projections exclude other deployments, removed logs and unconfirmed blocks", async () => {
  const indexerId = "premium-integration", address = `0x${"8".repeat(40)}`;
  const provider = { getBlock: async () => ({ hash: "premium-confirmed" }) };
  const service = load("services/indexedPremiumService.js", { "./blockchainIndexerService": { getIndexerContext: async () => ({ indexerId }), indexConfirmedEvents: async () => {} } });
  await Checkpoint.create({ indexerId, contractAddress: address, blockNumber: 3, blockHash: "premium-confirmed" });
  const base = { indexerId, contractAddress: address, contractName: "InsuranceManager", blockNumber: 3, blockHash: "premium-confirmed", eventName: "PremiumPaid", args: { policyId: "1", amount: "10" } };
  await IndexedEvent.create([
    { ...base, transactionHash: "premium-ok", logIndex: 0 },
    { ...base, transactionHash: "premium-other", logIndex: 0, indexerId: "other-premium-deployment" },
    { ...base, transactionHash: "premium-later", logIndex: 0, blockNumber: 4 },
    { ...base, transactionHash: "premium-removed", logIndex: 0, removed: true },
  ]);
  const rows = await service.readPremiumEvents({ target: address, runner: { provider } }, "1");
  assert.equal(rows.length, 1); assert.equal(rows[0].transactionHash, "premium-ok"); assert.equal(rows[0].index, 0);
  provider.getBlock = async () => ({ hash: "reorganized" });
  await assert.rejects(service.readPremiumEvents({ target: address, runner: { provider } }, "1"), /catching up/);
});

test("manual OTP email delivery requires a verified profile and fails without a pending code", async () => {
  const User = require("../models/User"), Account = require("../models/BankAccount"), Challenge = require("../models/BankOtpChallenge");
  await Promise.all([User.init(), Account.init(), Challenge.init()]);
  const walletAddress = `0x${"c".repeat(40)}`, accountReference = "EMAIL-TEST";
  await User.create({ walletAddress, email: "bank-otp@example.test" });
  await Account.create({ walletAddress, ownerWalletAddress: walletAddress, bankId: "DEMO", accountReference, accountHolderName: "Synthetic test holder", lastFour: "0000", balanceMinor: 1000000 });
  let fail = false;
  const service = load("services/bankPaymentService.js", {
    "./deploymentScopeService": { getDeploymentScope: async () => "synthetic-deployment" },
    "./contractService": { getPolicyEconomics: async () => ({ getInstallmentQuote: async () => ({ installmentId: 2n, amountWei: 10000000000000000n, dueAt: 1n, opensAt: 1n, payableNow: true, reinstatement: false }) }), getReadOnlyContract: () => ({ getPolicy: async () => ({ holderWallet: walletAddress, premiumAmount: 10000000000000000n, nextPremiumDueDate: 1n }), getEffectivePolicyStatus: async () => 1 }) },
    "./emailVerificationService": { reserveDelivery: async () => {} },
    "./otpDeliveryService": { deliveryMode: () => "brevo", deliverOtp: async ({ email }) => {
      assert.equal(email, "bank-otp@example.test"); if (fail) throw new Error("Delivery rejected"); return { deliveryMode: "brevo", maskedRecipient: "b***@example.test" };
    } },
  }, { BANK_OTP_SECRET: "isolated-bank-test-only" });
  const input = { walletAddress, accountReference, policyId: "1" };
  await assert.rejects(service.requestManualPaymentOtp(input), /Verify your saved profile email/);
  await User.updateOne({ walletAddress }, { verifiedEmail: "bank-otp@example.test" });
  const issued = await service.requestManualPaymentOtp(input);
  assert.equal(issued.demoOtp, undefined); assert.equal(issued.deliveryMode, "brevo");
  fail = true;
  await assert.rejects(service.requestManualPaymentOtp(input), /Delivery rejected/);
  assert.equal(await Challenge.countDocuments({ ownerWalletAddress: walletAddress, status: "PENDING" }), 0);
  assert.equal(await Challenge.countDocuments({ ownerWalletAddress: walletAddress, status: "FAILED" }), 1);
});

test("a stale OTP expiry check cannot overwrite a concurrently consumed challenge", async () => {
  const Challenge = require("../models/BankOtpChallenge");
  const walletAddress = `0x${"d".repeat(40)}`;
  const stale = await Challenge.create({ challengeId: "expiry-race", ownerWalletAddress: walletAddress, accountReference: "RACE", policyId: "1", otpHash: "unused", expiresAt: new Date(Date.now() - 1000) });
  const service = load("services/bankPaymentService.js", {
    "./deploymentScopeService": { getDeploymentScope: async () => "synthetic-deployment" },
    "../models/BankOtpChallenge": {
      findOne: () => ({ select: async () => { await Challenge.updateOne({ _id: stale._id }, { status: "USED" }); return stale; } }),
      updateOne: (...args) => Challenge.updateOne(...args),
    },
    "./otpDeliveryService": { deliveryMode: () => "simulation" },
  });
  await assert.rejects(service.confirmManualPaymentOtp({ walletAddress, challengeId: "expiry-race", otp: "123456" }), (error) => error.statusCode === 410);
  assert.equal((await Challenge.findById(stale._id)).status, "USED");
});
