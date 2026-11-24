const test = require("node:test");
const assert = require("node:assert/strict");
const { id } = require("ethers");
const load = require("./helpers/loadIsolatedModule");

function fixture(receipt, currentRoot) {
  const record = { _id: "record", invoiceHash: "invoice", updatedAt: 1, publicationPending: true };
  const records = [record];
  const job = { status: "PENDING", transactionHash: "", save: async () => {} };
  let sent = 0;
  const service = load("services/registryPublicationService.js", {
    "../models/MockHospitalRecord": {
      find: () => ({ sort: () => ({ lean: async () => records }), lean: async () => records }),
      updateOne: async () => { record.publicationPending = false; },
    },
    "../models/MockHospitalRecordOracle2": {
      bulkWrite: async () => {},
      find: () => ({ select: () => ({ lean: async () => [] }), lean: async () => records }),
    },
    "../models/RegistryPublication": { findOne: () => ({ sort: async () => job }) },
    "../models/RegistrySnapshotChunk": {
      updateOne: async () => {}, find: () => ({ lean: async () => [{ records }] }),
    },
    "./merkleRegistryService": {
      buildMerkleTree: () => ({ rootHash: "root", leafCount: 1, treeVersion: "version" }),
      getCanonicalRecordPayload: (r) => ({ invoiceHash: r.invoiceHash }), invalidateRegistryMerkleCache: () => {},
    },
    "./contractService": {
      getAdminContract: () => ({ runner: { provider: { getTransactionReceipt: receipt } } }),
      getOracleCoordinator: async () => ({
        currentRegistryVersion: async () => currentRoot ? 7n : 0n,
        getRegistrySnapshot: async () => ({ root: currentRoot, leafCount: 1n, treeVersionHash: id("version"), publishedAtBlock: 10n }),
        filters: { RegistrySnapshotPublished: (version, root, hash) => ({ version, root, hash }) },
        queryFilter: async (filter, first, last) => {
          assert.deepEqual(filter, { version: 7n, root: "root", hash: id("version") });
          assert.deepEqual([first, last], [10n, 10n]);
          return [{ transactionHash: "original-hash" }];
        },
        publishRegistrySnapshot: async () => {
        sent++;
        return { hash: "stored-hash", wait: () => { throw Error("Unsafe subscriber must not be used"); } };
      } }),
    },
  });
  return { service, job, record, sent: () => sent };
}

test("publisher contains receipt RPC rejection and reconciles its saved hash without rebroadcast", async () => {
  let limited = true;
  const f = fixture(async () => {
    if (limited) throw Object.assign(new Error("RPC capacity exceeded"), { code: 429 });
    return { status: 1 };
  });
  await assert.rejects(f.service.publishPendingRegistry(), { code: 429 });
  assert.equal(f.job.status, "PENDING");
  assert.equal(f.job.transactionHash, "stored-hash");
  assert.equal(f.record.publicationPending, true);
  limited = false;
  assert.equal((await f.service.publishPendingRegistry()).status, "PUBLISHED");
  assert.equal(f.record.publicationPending, false);
  assert.equal(f.sent(), 1);
});

test("identical pending snapshot adopts the existing canonical publication and clears the dirty marker", async () => {
  const checked = [];
  const f = fixture(async (hash) => { checked.push(hash); return { status: 1 }; }, "root");
  await f.service.publishPendingRegistry();
  assert.equal(f.job.transactionHash, "original-hash");
  assert.equal(f.sent(), 0);
  assert.equal(f.record.publicationPending, true);
  assert.equal((await f.service.publishPendingRegistry()).status, "PUBLISHED");
  assert.deepEqual(checked, ["original-hash"]);
  assert.equal(f.record.publicationPending, false);
  assert.equal(f.sent(), 0);
});

test("a changed root still publishes a new registry snapshot", async () => {
  const f = fixture(async () => ({ status: 1 }), "old-root");
  assert.equal((await f.service.publishPendingRegistry()).status, "PUBLISHED");
  assert.equal(f.job.transactionHash, "stored-hash");
  assert.equal(f.sent(), 1);
});

test("publisher retains unmined receipt for the next tick and never marks it published early", async () => {
  let mined = false;
  const f = fixture(async () => mined ? { status: 1 } : null);
  assert.equal((await f.service.publishPendingRegistry()).status, "PENDING");
  assert.equal(f.record.publicationPending, true);
  mined = true;
  assert.equal((await f.service.publishPendingRegistry()).status, "PUBLISHED");
  assert.equal(f.sent(), 1);
});
