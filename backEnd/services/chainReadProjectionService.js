const Snapshot = require("../models/ChainReadSnapshot");
const Checkpoint = require("../models/IndexerCheckpoint");
const Event = require("../models/IndexedBlockchainEvent");
const { getIndexerContext, indexConfirmedEvents } = require("./blockchainIndexerService");
const { getReadOnlyContract } = require("./contractService");
let pending;

const numeric = new Set(["claimId", "policyId", "packageId", "claimAmount", "incidentDate", "status", "verificationConfidence", "submittedAt", "coverageAmount", "premiumAmount", "premiumInterval", "premiumPaid", "totalPremiumPaid", "startDate", "endDate", "lastPaidTimestamp", "installmentsPaid", "nextPremiumDueDate", "gracePeriodEnd"]);
const hydrate = (data) => Object.fromEntries(Object.entries(data).map(([key, value]) => [key, numeric.has(key) && typeof value === "string" && /^\d+$/.test(value) ? BigInt(value) : value]));
const encode = (value) => JSON.parse(JSON.stringify(value.toObject(), (_key, item) => typeof item === "bigint" ? item.toString() : item));

async function refresh() {
  const manager = getReadOnlyContract();
  const provider = manager.runner.provider;
  const context = await getIndexerContext(provider);
  await indexConfirmedEvents();
  const raw = await Checkpoint.findOne({ indexerId: context.indexerId }).lean();
  if (!raw) throw Object.assign(new Error("Read projection is catching up"), { statusCode: 503 });
  const scope = `read:${context.indexerId}`;
  let cursor = await Checkpoint.findOne({ indexerId: scope }).lean();
  // Keep earlier entity versions so an interrupted refresh or reorg can rewind.
  if (cursor && (await provider.getBlock(cursor.blockNumber))?.hash !== cursor.blockHash) {
    await Checkpoint.deleteOne({ indexerId: scope });
    await Snapshot.deleteMany({ indexerId: scope });
    cursor = null;
  }
  if (cursor && cursor.blockNumber === raw.blockNumber) return { scope, cursor };
  const filter = { indexerId: context.indexerId, blockNumber: { $gt: cursor?.blockNumber ?? -1, $lte: raw.blockNumber } };
  const [claims, policies] = await Promise.all([
    Event.distinct("args.claimId", { ...filter, "args.claimId": { $exists: true } }),
    Event.distinct("args.policyId", { ...filter, "args.policyId": { $exists: true } }),
  ]);
  for (const [kind, ids, getter] of [["claim", claims, "getClaim"], ["policy", policies, "getPolicy"]]) {
    for (let start = 0; start < ids.length; start += 4) {
      await Promise.all(ids.slice(start, start + 4).filter((id) => /^[1-9]\d*$/.test(String(id))).map(async (id) => {
        const data = encode(await manager[getter](id, { blockTag: raw.blockNumber }));
        if (kind === "claim") {
          const economics = await require("./contractService").getPolicyEconomics(manager);
          data._settlement = encode(await manager.calculateSettlement(id, { blockTag: raw.blockNumber }));
          data._terms = encode(await economics.getPolicyTerms(data.policyId, { blockTag: raw.blockNumber }));
          if (Number(data.status) === 9) data._settledAmount = (await manager.getSettlementRecord(id, { blockTag: raw.blockNumber })).amount.toString();
        }
        await Snapshot.updateOne({ indexerId: scope, kind, entityId: String(id), blockNumber: raw.blockNumber }, { $set: { blockHash: raw.blockHash, data } }, { upsert: true });
      }));
    }
  }
  if ((await provider.getBlock(raw.blockNumber))?.hash !== raw.blockHash) throw Object.assign(new Error("Chain changed during projection refresh"), { statusCode: 503 });
  cursor = await Checkpoint.findOneAndUpdate({ indexerId: scope }, { contractAddress: manager.target.toLowerCase(), blockNumber: raw.blockNumber, blockHash: raw.blockHash }, { upsert: true, returnDocument: "after" }).lean();
  return { scope, cursor };
}
const ensure = () => {
  if (!pending) pending = refresh().finally(() => { pending = null; });
  return pending;
};
async function readEntities(kind) {
  const { scope, cursor } = await ensure();
  const rows = await Snapshot.aggregate([
    { $match: { indexerId: scope, kind, blockNumber: { $lte: cursor.blockNumber } } },
    { $sort: { blockNumber: -1 } },
    { $group: { _id: "$entityId", data: { $first: "$data" } } },
  ]);
  const reference = BigInt((await getReadOnlyContract().runner.provider.getBlock(cursor.blockNumber)).timestamp);
  return rows.map((row) => {
    const entity = hydrate(row.data);
    if (kind === "policy") {
      entity.status = entity.status === 4n ? 4n : reference > entity.endDate ? 5n : reference > entity.gracePeriodEnd ? 3n : reference > entity.nextPremiumDueDate ? 2n : 1n;
      entity.isActive = entity.status === 1n;
    }
    return entity;
  }).sort((a, b) => Number((a.claimId || a.policyId) - (b.claimId || b.policyId)));
}
module.exports = { readEntities, hydrate };
