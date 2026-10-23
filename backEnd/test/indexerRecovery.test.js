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
  const service = load("services/blockchainIndexerService.js", {
    ethers: { ethers: { ...ethers, Contract: class { async oracleCoordinator() { return `0x${"2".repeat(40)}`; } async claimAdjudicator() { return `0x${"3".repeat(40)}`; } async policyEconomics() { return `0x${"4".repeat(40)}`; } } } },
    "./contractService": { getProvider: () => provider, getContractAddress: () => address },
    "../models/IndexedBlock": blocks,
    "../models/IndexedBlockchainEvent": events,
    "../models/IndexerCheckpoint": checkpoints,
  }, environment);
  return { service, blocks, events, checkpoints, crashOn: (value) => { writes = 0; failAfter = value; }, changeFork: () => { fork = "b"; }, logFetches: () => logFetches };
}

test("an interrupted batch never promotes block markers beyond persisted events", async () => {
  const f = fixture();
  f.crashOn(2);
  await assert.rejects(f.service.indexConfirmedEvents(), /simulated crash/);
  assert.equal(f.checkpoints.rows.length, 0);
  assert.equal(f.events.rows.length, 1);
  assert.equal(f.blocks.rows.length, 3);
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
