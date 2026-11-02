const test = require("node:test");
const assert = require("node:assert/strict");
const { ethers } = require("ethers");
const load = require("./helpers/loadIsolatedModule");
const managerAbi = require("../abi/InsuranceManager.json").abi;

const matches = (row, filter) => Object.entries(filter).every(([key, value]) => {
  if (value && typeof value === "object") {
    if ("$gt" in value) return row[key] > value.$gt;
    if ("$gte" in value) return row[key] >= value.$gte;
    if ("$type" in value) return value.$type === "array" && Array.isArray(row[key]);
  }
  return row[key] === value;
});
function memoryModel() {
  const rows = [];
  const query = (filter, one = false) => {
    let sort = {};
    const result = () => {
      const values = rows.filter((row) => matches(row, filter)).sort((a, b) => {
        for (const [key, direction] of Object.entries(sort)) if (a[key] !== b[key]) return (a[key] > b[key] ? 1 : -1) * direction;
        return 0;
      });
      return one ? values[0] || null : values;
    };
    const chain = { sort: (value) => { sort = value; return chain; }, select: () => chain, lean: async () => result(), then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject) };
    return chain;
  };
  const update = async (filter, change) => {
    let row = rows.find((item) => matches(item, filter));
    if (!row) { row = { ...filter, ...change.$setOnInsert }; rows.push(row); }
    Object.assign(row, change.$set || {});
    // Mongo treats fields outside update operators as $set for findOneAndUpdate.
    if (!Object.keys(change).some((key) => key.startsWith("$"))) Object.assign(row, change);
    return row;
  };
  return {
    rows, find: (filter) => query(filter), findOne: (filter) => query(filter, true),
    updateOne: update, findOneAndUpdate: update,
    deleteOne: async (filter) => { const index = rows.findIndex((row) => matches(row, filter)); if (index >= 0) rows.splice(index, 1); },
    deleteMany: async (filter) => { for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], filter)) rows.splice(i, 1); },
    bulkWrite: async (operations) => { for (const { updateOne } of operations) await update(updateOne.filter, updateOne.update); },
  };
}

function fixture(environment = {}) {
  const blocks = memoryModel(), events = memoryModel(), checkpoints = memoryModel();
  const address = `0x${"1".repeat(40)}`;
  const iface = new ethers.Interface(managerAbi);
  const encoded = iface.encodeEventLog(iface.getEvent("ClaimSubmitted"), [1n, 1n, address, 10n]);
  let fork = "a";
  let writes = 0;
  let failAfter = Infinity;
  let logFetches = 0;
  const write = events.updateOne;
  events.updateOne = async (...args) => { if (++writes === failAfter) throw new Error("simulated crash during event write"); return write(...args); };
  const provider = {
    getNetwork: async () => ({ chainId: 31337n }),
    getBlockNumber: async () => 2,
    getBlock: async (number) => ({ number, hash: number === 2 ? `tip-${fork}` : `block-${number}`, parentHash: `block-${number - 1}` }),
    getLogs: async ({ fromBlock, toBlock }) => { logFetches++; return [1, 2].filter((number) => number >= fromBlock && number <= toBlock).map((number) => ({ ...encoded, address, index: 0, transactionHash: `tx-${number}-${number === 2 ? fork : "fixed"}`, blockNumber: number, blockHash: number === 2 ? `tip-${fork}` : `block-${number}` })); },
  };
  provider.send = async (method, params) => {
    assert.equal(method, "eth_getBlockByNumber");
    return provider.getBlock(Number(BigInt(params[0])));
  };
  const service = load("services/blockchainIndexerService.js", {
    ethers: { ethers: { ...ethers, Contract: class { async oracleCoordinator() { return `0x${"2".repeat(40)}`; } async claimAdjudicator() { return `0x${"3".repeat(40)}`; } async policyEconomics() { return `0x${"4".repeat(40)}`; } } } },
    "./contractService": { getProvider: () => provider, getContractAddress: () => address },
    "../models/IndexedBlock": blocks,
    "../models/IndexedBlockchainEvent": events,
    "../models/IndexerCheckpoint": checkpoints,
  }, environment);
  return { service, provider, blocks, events, checkpoints, crashOn: (value) => { writes = 0; failAfter = value; }, changeFork: () => { fork = "b"; }, logFetches: () => logFetches };
}

test("an interrupted batch never promotes block markers beyond persisted events", async () => {
  const f = fixture();
  f.crashOn(2);
  await assert.rejects(f.service.indexConfirmedEvents(), /simulated crash/);
  assert.equal(f.checkpoints.rows.length, 0);
  assert.equal(f.events.rows.length, 1);
  // Only event-bearing headers and the range endpoint are persisted now.
  assert.equal(f.blocks.rows.length, 2);
  f.crashOn(Infinity);
  await f.service.indexConfirmedEvents();
  assert.equal(f.events.rows.length, 2);
  assert.equal(f.checkpoints.rows[0].blockNumber, 2);
  await f.service.indexConfirmedEvents();
  assert.equal(f.events.rows.length, 2);
});

test("reorg rollback replaces orphaned events without deleting another deployment", async () => {
  const f = fixture();
  await f.service.indexConfirmedEvents();
  f.events.rows.push({ indexerId: "other-deployment", blockNumber: 2, transactionHash: "unrelated" });
  f.changeFork();
  await f.service.indexConfirmedEvents();
  assert.equal(f.events.rows.some((row) => row.transactionHash === "tx-2-a"), false);
  assert.equal(f.events.rows.some((row) => row.transactionHash === "tx-2-b"), true);
  assert.equal(f.events.rows.some((row) => row.transactionHash === "unrelated"), true);
});

test("indexer is single-flight and local automining indexes the tip without extra blocks", async () => {
  const f = fixture();
  const first = f.service.indexConfirmedEvents();
  const second = f.service.indexConfirmedEvents();
  assert.equal(first, second);
  await first;
  assert.equal(f.logFetches(), 1);
  assert.equal(f.checkpoints.rows[0].blockNumber, 2);
});

test("invalid confirmation and chunk configuration fail closed", async () => {
  await assert.rejects(fixture({ INDEXER_CONFIRMATIONS: "-1" }).service.indexConfirmedEvents(), /Invalid indexer/);
  await assert.rejects(fixture({ INDEXER_CHUNK_SIZE: "0" }).service.indexConfirmedEvents(), /Invalid indexer/);
});

test("73,000 empty blocks use range endpoints instead of 73,000 header reads", async () => {
  const f = fixture({ INDEXER_CHUNK_SIZE: "500" });
  let reads = 0, ranges = 0;
  const getBlock = f.provider.getBlock;
  f.provider.getBlock = async (number) => { reads++; return getBlock(number); };
  f.provider.getBlockNumber = async () => 72999;
  f.provider.getLogs = async () => { ranges++; return []; };
  const result = await f.service.indexConfirmedEvents();
  assert.equal(result.indexedBlocks, 73000);
  assert.equal(result.indexedEvents, 0);
  assert.equal(ranges, 146);
  // Fresh endpoint rechecks plus the preceding committed anchor prevent a
  // fork across chunk boundaries from being hidden during long catch-ups.
  assert.equal(reads, 438);
  assert.equal(f.blocks.rows.length, 146);
  assert.equal(f.checkpoints.rows[0].blockNumber, 72999);
  await f.service.indexConfirmedEvents();
  assert.equal(ranges, 146); // Resume at durable checkpoint; no rescan.
});

test("an existing dense checkpoint resumes without discarding canonical history", async () => {
  const f = fixture();
  const { indexerId } = await f.service.getIndexerContext(f.provider);
  for (const number of [0, 1, 2]) f.blocks.rows.push({ indexerId, blockNumber: number, blockHash: number === 2 ? "tip-a" : `block-${number}` });
  f.checkpoints.rows.push({ indexerId, blockNumber: 2, blockHash: "tip-a" });
  const result = await f.service.indexConfirmedEvents();
  assert.equal(result.indexedBlocks, 0);
  assert.equal(f.blocks.rows.length, 3);
  assert.equal(f.logFetches(), 0);
});

test("a sparse-range reorg replays the complete gap from the last canonical endpoint", async () => {
  const f = fixture({ INDEXER_CHUNK_SIZE: "10" });
  let fork = false;
  const ranges = [];
  f.provider.getBlockNumber = async () => 29;
  f.provider.getBlock = async (number) => ({ number, hash: `${number >= 10 && fork ? "new" : "old"}-${number}`, parentHash: "parent" });
  f.provider.getLogs = async ({ fromBlock, toBlock }) => { ranges.push([fromBlock, toBlock]); return []; };
  await f.service.indexConfirmedEvents();
  assert.deepEqual(f.blocks.rows.map((r) => r.blockNumber).sort((a, b) => a - b), [9, 19, 29]);
  fork = true;
  f.events.rows.push({ indexerId: f.checkpoints.rows[0].indexerId, blockNumber: 12, transactionHash: "orphan" });
  ranges.length = 0;
  await f.service.indexConfirmedEvents();
  assert.deepEqual(ranges, [[10, 19], [20, 29]]);
  assert.equal(f.events.rows.some((r) => r.transactionHash === "orphan"), false);
  assert.equal(f.checkpoints.rows[0].blockNumber, 29);
});

test("a fork during range processing cannot advance the checkpoint, even for empty ranges", async () => {
  const f = fixture();
  const getBlock = f.provider.getBlock;
  let fork = false;
  f.provider.getLogs = async () => { fork = true; return []; };
  f.provider.getBlock = async (number) => ({ ...await getBlock(number), ...(number === 2 && fork ? { hash: "changed-tip" } : {}) });
  await assert.rejects(f.service.indexConfirmedEvents(), /Chain changed/);
  assert.equal(f.checkpoints.rows.length, 0);
  // Restart discards uncommitted endpoint markers and safely retries.
  f.provider.getLogs = async () => [];
  await f.service.indexConfirmedEvents();
  assert.equal(f.checkpoints.rows[0].blockHash, "changed-tip");
});

test("inconsistent event hashes or out-of-range logs fail before committing history", async () => {
  for (const mode of ["hash", "range"]) {
    const f = fixture();
    const getLogs = f.provider.getLogs;
    f.provider.getLogs = async (filter) => (await getLogs(filter)).map((log) => ({ ...log,
      ...(mode === "hash" ? { blockHash: "wrong-fork" } : { blockNumber: 999 }),
    }));
    await assert.rejects(f.service.indexConfirmedEvents(), mode === "hash" ? /Log block hash/ : /Log outside/);
    assert.equal(f.checkpoints.rows.length, 0);
    assert.equal(f.events.rows.length, 0);
  }
});

test("a fork of previously committed history during catch-up must not be hidden by a new canonical endpoint", async () => {
  const f = fixture({ INDEXER_CHUNK_SIZE: "10" });
  let head = 9, fork = false;
  f.provider.getBlockNumber = async () => head;
  f.provider.getBlock = async (number) => ({ number, hash: `${fork && number >= 5 ? "new" : "old"}-${number}`, parentHash: "parent" });
  f.provider.getLogs = async () => [];
  await f.service.indexConfirmedEvents();
  const indexerId = f.checkpoints.rows[0].indexerId;
  f.events.rows.push({ indexerId, blockNumber: 7, transactionHash: "old-history" });
  head = 19;
  const getBlock = f.provider.getBlock;
  // rollbackReorgs first sees canonical block 9, then the fork arrives before
  // range 10..19 is read. Both observations of block 19 are on the new chain.
  f.provider.getBlock = async (number) => { if (number === 19) fork = true; return getBlock(number); };
  await assert.rejects(f.service.indexConfirmedEvents(), /Previous checkpoint changed/);
  assert.equal(f.checkpoints.rows[0].blockNumber, 9);
  await f.service.indexConfirmedEvents();
  assert.equal(f.events.rows.some((row) => row.transactionHash === "old-history"), false);
  assert.equal(f.checkpoints.rows[0].blockNumber, 19);
});

test("a missing checkpoint block is an RPC failure, not permission to delete committed history", async () => {
  const f = fixture();
  await f.service.indexConfirmedEvents();
  const before = JSON.stringify({ blocks: f.blocks.rows, events: f.events.rows, checkpoints: f.checkpoints.rows });
  f.provider.getBlock = async (number) => number === 2 ? null : ({ number, hash: `block-${number}` });
  await assert.rejects(f.service.indexConfirmedEvents(), /checkpoint block is unavailable/);
  assert.equal(JSON.stringify({ blocks: f.blocks.rows, events: f.events.rows, checkpoints: f.checkpoints.rows }), before);
});
