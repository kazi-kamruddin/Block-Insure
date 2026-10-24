const test = require("node:test"), assert = require("node:assert/strict");
const mongoose = require("mongoose"), { ethers } = require("ethers");
const Chunk = require("../models/RegistrySnapshotChunk");
const Model = require("../models/ClaimAdvisoryAssessment");
const Shadow = require("../models/OracleShadowAssessment");
const { buildMerkleTree } = require("../services/merkleRegistryService");
const { createAdvisoryService, readCommittedRecords } = require("../services/xgboostAdvisoryService");
let name;
test.before(async () => {
  const uri = new URL(process.env.E2E_MONGODB_URI);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(uri.hostname)) throw new Error("Prepared loopback MongoDB required");
  name = `xgboost_advisory_${Date.now()}_test`; uri.pathname = `/${name}`;
  await mongoose.connect(uri.toString()); await Promise.all([Chunk.init(), Model.init(), Shadow.init()]);
});
test.after(async () => {
  if (mongoose.connection.name === name && /^xgboost_advisory_\d+_test$/.test(name)) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
const wallet = `0x${"1".repeat(40)}`;
const record = { hospitalId: "HOSP-001", patientHash: ethers.id("patient"), authorizedClaimants: [wallet],
  treatmentType: "HOSPITALIZATION", diagnosisCode: "D1", admissionDate: "2026-10-20T00:00:00.000Z", dischargeDate: "2026-10-20T00:00:00.000Z", invoiceDate: "2026-10-20T00:00:00.000Z",
  billAmount: "0.1", expectedBillMin: "0.01", expectedBillMax: "1", invoiceNumber: "invoice", invoiceHash: ethers.id("invoice"), invoiceStatus: "VALID", recordStatus: "VALID", licenseStatus: "ACTIVE" };
const root = buildMerkleTree([record]).rootHash;
const input = { claim: { claimId: 1n, claimantWallet: wallet, claimAmount: ethers.parseEther("0.1"), hospitalId: "HOSP-001", invoiceHash: record.invoiceHash,
  incidentDate: BigInt(Date.parse(record.admissionDate) / 1000), claimType: record.treatmentType, submittedAt: 1792627200n },
  claimVersion: "1", deploymentId: "local-test-A", registryRoot: root, registryVersion: "1", snapshotTimestamp: 1792713600, blockHash: ethers.id("block") };

test("archived context integrity, immutable persistence and process-cache restart recovery", async () => {
  await Chunk.create({ rootHash: root, chunkIndex: 0, records: [record] });
  const first = await createAdvisoryService()(input);
  assert.equal(first.status, "AVAILABLE");
  assert.equal(await Model.countDocuments(), 1);
  const restarted = createAdvisoryService();
  const parallel = await Promise.all(Array.from({ length: 5 }, () => restarted(input)));
  for (const result of parallel) assert.deepEqual(result, first);
  const another = await restarted({ ...input, deploymentId: "local-test-B" });
  assert.notEqual(another.assessmentId, first.assessmentId);
  assert.equal(await Model.countDocuments(), 2);
  await Chunk.updateOne({ rootHash: root }, { $set: { "records.0.billAmount": "999" } });
  await assert.rejects(readCommittedRecords(root), /Snapshot corrupt/);
  await assert.rejects(createAdvisoryService()(input), /Snapshot corrupt/);
  assert.equal(await Model.countDocuments(), 2);
});

test("missing roots and interrupted archive chunks never fall back to current records", async () => {
  await assert.rejects(readCommittedRecords(ethers.id("missing")), /Snapshot unavailable/);
  const gapRoot = ethers.id("gap");
  await Chunk.create({ rootHash: gapRoot, chunkIndex: 1, records: [record] });
  await assert.rejects(readCommittedRecords(gapRoot), /incomplete/);
});

test("shadow agreement requires distinct wallets and isolates request block/deployment identity", async () => {
  const { getAgreement } = require("../services/oracleShadowService");
  const coordinatorAddress = `0x${"3".repeat(40)}`;
  const scope = { requestId: "70", claimVersion: "1", registryRoot: root, bundleHash: "bundle", manifestHash: "manifest",
    coordinatorAddress, chainId: "31337", requestBlockHash: ethers.id("request-block") };
  const row = { contextId: "context", requestId: "70", claimId: "1", claimVersion: "1", coordinatorAddress,
    oracleWallet: `0x${"4".repeat(40)}`, oracleInstanceId: "1", binding: { ...scope }, result: {}, resultHash: "result",
    contextHash: "features", explanationHash: "explanation", metrics: {} };
  await Shadow.create({ ...row, _id: "shadow-one" });
  assert.equal((await getAgreement(scope)).status, "WAITING_FOR_WORKERS");
  await Shadow.create({ ...row, _id: "shadow-duplicate-wallet", oracleInstanceId: "2" });
  assert.equal((await getAgreement(scope)).status, "WAITING_FOR_WORKERS");
  await Shadow.deleteOne({ _id: "shadow-duplicate-wallet" });
  await Shadow.create({ ...row, _id: "shadow-two", oracleWallet: `0x${"5".repeat(40)}`, oracleInstanceId: "2" });
  assert.equal((await getAgreement(scope)).status, "MATCHED");
  assert.equal((await getAgreement({ ...scope, requestBlockHash: ethers.id("different-deployment-block") })).reports, 0);
  await Shadow.updateOne({ _id: "shadow-two" }, { $set: { resultHash: "inconsistent" } });
  assert.equal((await getAgreement(scope)).status, "CONFLICT");
});
