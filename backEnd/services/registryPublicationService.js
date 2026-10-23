const Primary = require("../models/MockHospitalRecord");
const Secondary = require("../models/MockHospitalRecordOracle2");
const Publication = require("../models/RegistryPublication");
const Chunk = require("../models/RegistrySnapshotChunk");
const { buildMerkleTree, getCanonicalRecordPayload, invalidateRegistryMerkleCache } = require("./merkleRegistryService");
const { getAdminContract, getOracleCoordinator } = require("./contractService");
const { ethers } = require("ethers");
let running;
let timer;

const queueRegistryPublication = () => Publication.create({ status: "PENDING" });
const publishPendingRegistry = () => {
  if (running) return running;
  running = (async () => {
    let job = await Publication.findOne({ status: "PENDING" }).sort({ createdAt: 1 });
    // Record-local dirty markers survive a crash between CRUD and job creation.
    if (!job && await Primary.exists({ publicationPending: true })) job = await queueRegistryPublication();
    if (!job) return null;
    try {
      const manager = getAdminContract();
      const coordinator = await getOracleCoordinator(manager);
      if (job.transactionHash) {
        const receipt = await manager.runner.provider.getTransactionReceipt(job.transactionHash);
        if (!receipt) return job;
        if (Number(receipt.status) === 1) {
          job.status = "PUBLISHED";
          await job.save();
          invalidateRegistryMerkleCache();
          const chunks = await Chunk.find({ rootHash: job.rootHash }).lean();
          const published = new Map(chunks.flatMap((chunk) => chunk.records)
            .map((record) => [record.invoiceHash, JSON.stringify(getCanonicalRecordPayload(record))]));
          // Identical roots can reuse an older immutable archive whose MongoDB
          // timestamps differ. Compare committed content, then CAS the live revision.
          for (const record of await Primary.find({ publicationPending: true }).lean()) {
            if (published.get(record.invoiceHash) === JSON.stringify(getCanonicalRecordPayload(record))) {
              await Primary.updateOne({ _id: record._id, updatedAt: record.updatedAt }, { $set: { publicationPending: false } });
            }
          }
          return job;
        }
        job.transactionHash = "";
      }
      const records = await Primary.find().sort({ invoiceHash: 1 }).lean();
      const tree = buildMerkleTree(records);
      if (!tree.rootHash) throw new Error("Cannot publish an empty registry");
      // The two workers share a publisher, not independent medical truth.
      await Secondary.bulkWrite(records.map(({ _id, __v, ...record }) => ({ updateOne: {
        filter: { invoiceHash: record.invoiceHash }, update: { $set: record }, upsert: true,
      } })));
      const other = buildMerkleTree(await Secondary.find().lean());
      if (other.rootHash !== tree.rootHash) throw new Error("Worker registries differ; publication withheld");
      for (let offset = 0; offset < records.length; offset += 250) {
        await Chunk.updateOne({ rootHash: tree.rootHash, chunkIndex: offset / 250 }, {
          $setOnInsert: { records: records.slice(offset, offset + 250) },
        }, { upsert: true });
      }
      job.rootHash = tree.rootHash;
      const tx = await coordinator.publishRegistrySnapshot(tree.rootHash, tree.leafCount, ethers.id(tree.treeVersion));
      job.transactionHash = tx.hash;
      await job.save(); // Persist before waiting; restart reconciles this receipt.
      await tx.wait();
      job.status = "PUBLISHED";
      job.lastError = "";
      await job.save();
      invalidateRegistryMerkleCache();
      for (const record of records) {
        if (record.publicationPending) await Primary.updateOne({ _id: record._id, updatedAt: record.updatedAt }, { $set: { publicationPending: false } });
      }
      return job;
    } catch (error) {
      job.lastError = "Registry publication pending; inspect server diagnostics";
      await job.save();
      throw error;
    }
  })().finally(() => { running = null; });
  return running;
};
const startRegistryPublisher = () => {
  if (timer) return;
  const tick = () => publishPendingRegistry().catch(() => console.error("Registry publication will retry"));
  tick();
  timer = setInterval(tick, 30000);
  timer.unref?.();
};
const stopRegistryPublisher = () => { clearInterval(timer); timer = null; };
module.exports = { queueRegistryPublication, publishPendingRegistry, startRegistryPublisher, stopRegistryPublisher };
