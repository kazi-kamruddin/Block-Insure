const Event = require("../models/IndexedBlockchainEvent");
const Checkpoint = require("../models/IndexerCheckpoint");
const { getIndexerContext, indexConfirmedEvents } = require("./blockchainIndexerService");
async function readPremiumEvents(contract, policyId) {
  const provider = contract.runner.provider || contract.runner;
  const context = await getIndexerContext(provider);
  await indexConfirmedEvents();
  const cursor = await Checkpoint.findOne({ indexerId: context.indexerId }).lean();
  if (!cursor || (await provider.getBlock(cursor.blockNumber))?.hash !== cursor.blockHash) throw Object.assign(new Error("Payment projection is catching up. Retry shortly."), { statusCode: 503 });
  const rows = await Event.find({ indexerId: context.indexerId, contractAddress: String(contract.target).toLowerCase(), eventName: "PremiumPaid", "args.policyId": String(policyId), removed: false, blockNumber: { $lte: cursor.blockNumber } })
    .sort({ blockNumber: 1, logIndex: 1 }).limit(10001).lean();
  if (rows.length > 10000) throw Object.assign(new Error("Statement exceeds the supported payment count; narrow the selected policy."), { statusCode: 422 });
  if ((await provider.getBlock(cursor.blockNumber))?.hash !== cursor.blockHash) throw Object.assign(new Error("Chain changed while reading payments. Retry shortly."), { statusCode: 503 });
  return rows.map((row) => ({ ...row, index: row.logIndex }));
}
module.exports = { readPremiumEvents };
