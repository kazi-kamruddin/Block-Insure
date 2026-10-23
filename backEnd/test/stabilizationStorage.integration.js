const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { MongoMemoryServer } = require("mongodb-memory-server");
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
let database;
test.before(async () => {
  database = await MongoMemoryServer.create({ binary: { downloadDir: path.resolve(__dirname, "../../node_modules/.cache/mongodb-binaries") }, instance: { ip: "127.0.0.1" } });
  await mongoose.connect(database.getUri("stabilization_storage_test"));
  await Promise.all([Primary, Secondary, Publication, Chunk, File, EvidenceEvent, IndexedEvent, IndexedBlock, Checkpoint].map((model) => model.init()));
});
test.after(async () => { await mongoose.disconnect(); await database?.stop(); });

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
  await Primary.create(record("one"));
  await publisher.queueRegistryPublication();
  const first = await publisher.publishPendingRegistry();
  assert.equal(first.status, "PUBLISHED");
  assert.equal((await merkle.getCachedRegistryTree()).rootHash, first.rootHash);
  assert.equal(await Primary.countDocuments({ publicationPending: true }), 0);
  await Primary.updateOne({ invoiceNumber: "one" }, { $set: { billAmount: "0.2", publicationPending: true } });
  await Primary.create(record("two"));
  // No job is queued: emulate a crash between the source write and job creation.
  const second = await publisher.publishPendingRegistry();
  assert.notEqual(second.rootHash, first.rootHash);
  assert.equal(merkle.buildMerkleTree(await Primary.find().lean()).rootHash, merkle.buildMerkleTree(await Secondary.find().lean()).rootHash);
  const oldProof = await merkle.buildRegistryMerkleProof({ invoiceHash: ethers.id("one"), rootHash: first.rootHash });
  const newProof = await merkle.buildRegistryMerkleProof({ invoiceHash: ethers.id("one"), rootHash: second.rootHash, registrySnapshot: "oracle2" });
  assert.equal(oldProof.canonicalRecord.billAmount, "0.1");
  assert.equal(newProof.canonicalRecord.billAmount, "0.2");
  assert.equal(merkle.verifyMerkleProof(oldProof), true);
  assert.equal(merkle.verifyMerkleProof(newProof), true);
});

test("publication resumes an already mined transaction without sending it twice", async () => {
  let calls = 0;
  let confirmed = false;
  const dependencies = { "./contractService": {
    getAdminContract: () => ({ runner: { provider: { getTransactionReceipt: async () => confirmed ? { status: 1 } : null } } }),
    getOracleCoordinator: async () => ({ publishRegistrySnapshot: async () => { calls++; return { hash: `0x${"a".repeat(64)}`, wait: async () => { throw new Error("lost receipt response"); } }; } }),
  } };
  const publisher = load("services/registryPublicationService.js", dependencies);
  await Primary.updateOne({ invoiceNumber: "two" }, { $set: { publicationPending: true } });
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
