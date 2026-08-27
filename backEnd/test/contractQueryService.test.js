const assert = require("node:assert/strict");
const test = require("node:test");
const { ethers } = require("ethers");
const File = require("../models/File");
const {
  assignEvidenceChainLink,
} = require("../services/evidenceChainService");
const {
  paginate,
  parsePagination,
} = require("../services/contractQueryService");

test("normalizes and caps API pagination", () => {
  assert.deepEqual(parsePagination({}), { page: 1, limit: 50 });
  assert.deepEqual(parsePagination({ page: "2", limit: "25" }), {
    page: 2,
    limit: 25,
  });
  assert.deepEqual(parsePagination({ page: "-1", limit: "1000" }), {
    page: 1,
    limit: 100,
  });
});

test("returns bounded pages with navigation metadata", () => {
  const result = paginate([1, 2, 3, 4, 5], { page: 2, limit: 2 });

  assert.deepEqual(result.items, [3, 4]);
  assert.deepEqual(result.pagination, {
    page: 2,
    limit: 2,
    total: 5,
    totalPages: 3,
    hasNextPage: true,
    hasPreviousPage: true,
  });
});

test("accepts only a fresh heartbeat signed by an on-chain oracle", async () => {
  const { _verifyHeartbeat } = require("../controllers/oracleController");
  const wallet = ethers.Wallet.createRandom();
  const heartbeatTimestamp = new Date().toISOString();
  const heartbeat = {
    oracleWallet: wallet.address,
    oracleInstanceId: "1",
    heartbeatTimestamp,
    lastProcessedRequestId: "4",
    lastProcessedClaimId: "9",
    lastTxHash: ethers.ZeroHash,
  };
  const message = [
    "Block-Insure oracle heartbeat",
    heartbeat.oracleInstanceId,
    heartbeat.oracleWallet.toLowerCase(),
    heartbeatTimestamp,
    heartbeat.lastProcessedRequestId,
    heartbeat.lastProcessedClaimId,
    heartbeat.lastTxHash.toLowerCase(),
  ].join(":");
  const contract = {
    ORACLE_ROLE: async () => ethers.id("ORACLE_ROLE"),
    hasRole: async (_role, address) =>
      address.toLowerCase() === wallet.address.toLowerCase(),
  };

  await _verifyHeartbeat({
    contract,
    ...heartbeat,
    heartbeatSignature: await wallet.signMessage(message),
  });

  await assert.rejects(
    _verifyHeartbeat({
      contract,
      ...heartbeat,
      lastProcessedClaimId: "10",
      heartbeatSignature: await wallet.signMessage(message),
    }),
    /signer does not match|signature is invalid/
  );
});

test("retries evidence-chain allocation after a concurrent index conflict", async () => {
  const originalFindOne = File.findOne;
  let headReadCount = 0;
  let saveCount = 0;
  const fileRecord = {
    _id: "document-b",
    claimId: "",
    sha256Hash: "document-hash",
    ipfsCID: "cid-b",
    documentType: "CLAIM_DOCUMENT",
    uploaderWallet: "0x0000000000000000000000000000000000000002",
    save: async () => {
      saveCount += 1;
      if (saveCount === 1) {
        const conflict = new Error("duplicate chain index");
        conflict.code = 11000;
        throw conflict;
      }
    },
  };

  File.findOne = () => ({
    sort: async () => {
      headReadCount += 1;
      return headReadCount === 1
        ? null
        : { evidenceChainHash: "existing-head", evidenceChainIndex: 0 };
    },
  });

  try {
    await assignEvidenceChainLink(fileRecord, "9");
    assert.equal(saveCount, 2);
    assert.equal(fileRecord.evidenceChainIndex, 1);
    assert.equal(fileRecord.previousEvidenceHash, "existing-head");
    assert.match(fileRecord.evidenceChainHash, /^[a-f0-9]{64}$/);
  } finally {
    File.findOne = originalFindOne;
  }
});
