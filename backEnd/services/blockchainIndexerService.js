const { ethers } = require("ethers");
const InsuranceManagerArtifact = require("../abi/InsuranceManager.json");
const OracleCoordinatorArtifact = require("../abi/OracleCoordinator.json");
const ClaimAdjudicatorArtifact = require("../abi/ClaimAdjudicator.json");
const PolicyEconomicsArtifact = require("../abi/PolicyEconomics.json");
const EvidenceRegistryArtifact = require("../abi/EvidenceRegistry.json");
const IndexedBlock = require("../models/IndexedBlock");
const IndexedBlockchainEvent = require("../models/IndexedBlockchainEvent");
const IndexerCheckpoint = require("../models/IndexerCheckpoint");
const { getContractAddress, getProvider } = require("./contractService");

const INDEXER_ID = "insurance-manager-v1";
const CHUNK_SIZE = Number(process.env.INDEXER_CHUNK_SIZE || 500);
let indexerTimer = null;
let indexingPromise = null;
let indexMigration;

const ensureIndexerIndexes = () => {
  if (!indexMigration) indexMigration = (async () => {
    const collection = IndexedBlockchainEvent.collection;
    await collection.createIndex({ indexerId: 1, contractAddress: 1, transactionHash: 1, logIndex: 1 }, { unique: true });
    const old = (await collection.indexes()).find((index) => index.unique && JSON.stringify(index.key) === JSON.stringify({ contractAddress: 1, transactionHash: 1, logIndex: 1 }));
    // Replace only the obsolete uniqueness constraint; preserve all events.
    if (old) await collection.dropIndex(old.name);
  })().catch((error) => { indexMigration = null; throw error; });
  return indexMigration;
};

const getIndexerContext = async (provider) => {
  const network = await provider.getNetwork();
  const deploymentBlock = Number(process.env.CONTRACT_DEPLOYMENT_BLOCK || 0);
  const block = await provider.getBlock(deploymentBlock);
  if (!block) throw new Error("Indexer deployment block is unavailable");
  const confirmations = Number(process.env.INDEXER_CONFIRMATIONS ?? (network.chainId === 31337n ? 0 : 3));
  if (!Number.isSafeInteger(confirmations) || confirmations < 0 || !Number.isSafeInteger(CHUNK_SIZE) || CHUNK_SIZE < 1 || CHUNK_SIZE > 2000) {
    throw new Error("Invalid indexer confirmation depth or chunk size");
  }
  return { indexerId: `${INDEXER_ID}:${network.chainId}:${getContractAddress().toLowerCase()}:${block.hash}`, confirmations, deploymentBlock };
};

const eventIdentity = (log) =>
  `${log.address.toLowerCase()}:${log.transactionHash.toLowerCase()}:${log.index}`;

const findReorgRollbackHeight = (indexedBlocks, canonicalHashes) => {
  const ordered = [...indexedBlocks].sort((left, right) => left.blockNumber - right.blockNumber);
  let lastCanonicalIndex = -1;
  for (let index = 0; index < ordered.length; index += 1) {
    if (canonicalHashes.get(ordered[index].blockNumber) !== ordered[index].blockHash) break;
    lastCanonicalIndex = index;
  }
  return lastCanonicalIndex === ordered.length - 1
    ? null
    : ordered[lastCanonicalIndex + 1]?.blockNumber ?? null;
};

const getIndexedSources = async (provider) => {
  const managerAddress = getContractAddress().toLowerCase();
  const manager = new ethers.Contract(
    managerAddress,
    InsuranceManagerArtifact.abi,
    provider
  );
  const [coordinatorAddress, adjudicatorAddress, economicsAddress] =
    await Promise.all([
      manager.oracleCoordinator(),
      manager.claimAdjudicator(),
      manager.policyEconomics(),
    ]);
  const configured = [
    ["InsuranceManager", managerAddress, InsuranceManagerArtifact.abi],
    ["OracleCoordinator", coordinatorAddress, OracleCoordinatorArtifact.abi],
    ["ClaimAdjudicator", adjudicatorAddress, ClaimAdjudicatorArtifact.abi],
    ["PolicyEconomics", economicsAddress, PolicyEconomicsArtifact.abi],
  ];
  if (process.env.POLICY_BENEFITS_ADDRESS) configured.push(["PolicyBenefitsManager", process.env.POLICY_BENEFITS_ADDRESS, require("../abi/PolicyBenefitsManager.json").abi]);
  if (process.env.EVIDENCE_REGISTRY_ADDRESS) {
    configured.push([
      "EvidenceRegistry",
      process.env.EVIDENCE_REGISTRY_ADDRESS,
      EvidenceRegistryArtifact.abi,
    ]);
  }
  for (const [name, key] of [["HospitalVerificationRegistry", "HOSPITAL_VERIFICATION_REGISTRY_ADDRESS"], ["BankIdentityRegistry", "BANK_IDENTITY_REGISTRY_ADDRESS"]]) {
    if (process.env[key]) configured.push([name, process.env[key], require(`../abi/${name}.json`).abi]);
  }
  return new Map(
    configured.map(([name, address, abi]) => [
      address.toLowerCase(),
      { name, interface: new ethers.Interface(abi) },
    ])
  );
};

const jsonSafe = (value) => {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value)) {
    return value.toLowerCase();
  }
  if (value && typeof value.toObject === "function") {
    try {
      return jsonSafe(value.toObject());
    } catch (error) {
      // ethers Result#toObject throws when a tuple/array contains unnamed
      // values. Those values are still safely serializable by position.
      if (!Array.isArray(value)) throw error;
    }
  }
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => Number.isNaN(Number(key)))
        .map(([key, child]) => [key, jsonSafe(child)])
    );
  }
  return value;
};

const normalizeIndexedEventArgs = (sourceInterface, eventName, args) => {
  if (!Array.isArray(args)) return jsonSafe(args);
  const fragment = sourceInterface.getEvent(eventName);
  if (!fragment || fragment.inputs.length !== args.length) return jsonSafe(args);

  return Object.fromEntries(
    fragment.inputs.map((input, index) => [
      input.name || String(index),
      jsonSafe(args[index]),
    ])
  );
};

const migrateLegacyIndexedEventArgs = async (indexedSources) => {
  const legacyEvents = await IndexedBlockchainEvent.find({
    args: { $type: "array" },
  })
    .select("_id contractAddress eventName args")
    .lean();
  const updates = legacyEvents.flatMap((event) => {
    const source = indexedSources.get(event.contractAddress.toLowerCase());
    if (!source) return [];
    const args = normalizeIndexedEventArgs(
      source.interface,
      event.eventName,
      event.args
    );
    if (Array.isArray(args)) return [];
    return [{
      updateOne: {
        filter: { _id: event._id },
        update: { $set: { args } },
      },
    }];
  });

  if (updates.length > 0) {
    await IndexedBlockchainEvent.bulkWrite(updates);
  }
  return updates.length;
};

const rollbackReorgs = async (provider, context = null) => {
  const { indexerId } = context || await getIndexerContext(provider);
  const completed = await IndexerCheckpoint.findOne({ indexerId });
  // Block markers can precede event writes. Never promote an incomplete batch.
  await IndexedBlock.deleteMany({ indexerId, blockNumber: { $gt: completed?.blockNumber ?? -1 } });
  await IndexedBlockchainEvent.deleteMany({ indexerId, blockNumber: { $gt: completed?.blockNumber ?? -1 } });
  let latest = await IndexedBlock.findOne({ indexerId }).sort({ blockNumber: -1 });
  while (latest) {
    const canonical = await provider.getBlock(latest.blockNumber);
    if (canonical?.hash === latest.blockHash) break;
    await Promise.all([
      IndexedBlockchainEvent.deleteMany({ indexerId, blockNumber: { $gte: latest.blockNumber } }),
      IndexedBlock.deleteMany({ indexerId, blockNumber: { $gte: latest.blockNumber } }),
    ]);
    latest = await IndexedBlock.findOne({ indexerId }).sort({ blockNumber: -1 });
  }

  if (!latest) {
    await IndexerCheckpoint.deleteOne({ indexerId });
    return null;
  }
  return IndexerCheckpoint.findOneAndUpdate(
    { indexerId },
    {
      contractAddress: getContractAddress().toLowerCase(),
      blockNumber: latest.blockNumber,
      blockHash: latest.blockHash,
    },
    { returnDocument: "after", upsert: true }
  );
};

const runIndexingBatch = async () => {
  const provider = getProvider();
  const context = await getIndexerContext(provider);
  const { indexerId } = context;
  const contractAddress = getContractAddress().toLowerCase();
  const indexedSources = await getIndexedSources(provider);
  await migrateLegacyIndexedEventArgs(indexedSources);
  const checkpoint = await rollbackReorgs(provider, context);
  const latestBlock = await provider.getBlockNumber();
  const confirmedThrough = latestBlock - context.confirmations;
  let fromBlock = checkpoint
    ? checkpoint.blockNumber + 1
    : context.deploymentBlock;
  if (confirmedThrough < fromBlock) return { indexedBlocks: 0, indexedEvents: 0 };

  let indexedBlocks = 0;
  let indexedEvents = 0;
  for (; fromBlock <= confirmedThrough; fromBlock += CHUNK_SIZE) {
    const toBlock = Math.min(fromBlock + CHUNK_SIZE - 1, confirmedThrough);
    const [logs, blocks] = await Promise.all([
      provider.getLogs({
        address: [...indexedSources.keys()],
        fromBlock,
        toBlock,
      }),
      Promise.all(
        Array.from({ length: toBlock - fromBlock + 1 }, (_, offset) =>
          provider.getBlock(fromBlock + offset)
        )
      ),
    ]);

    if (blocks.some((block) => !block)) throw new Error("Confirmed block disappeared during indexing");
    await IndexedBlock.bulkWrite(
      blocks.map((block) => ({
        updateOne: {
          filter: { indexerId, blockNumber: block.number },
          update: {
            $setOnInsert: {
              indexerId,
              blockNumber: block.number,
              blockHash: block.hash,
              parentHash: block.parentHash,
            },
          },
          upsert: true,
        },
      }))
    );

    for (const log of logs) {
      const source = indexedSources.get(log.address.toLowerCase());
      if (!source) continue;
      let parsed;
      try {
        parsed = source.interface.parseLog(log);
      } catch {
        continue;
      }
      await IndexedBlockchainEvent.updateOne(
        {
          indexerId,
          contractAddress: log.address.toLowerCase(),
          transactionHash: log.transactionHash,
          logIndex: log.index,
        },
        {
          $setOnInsert: {
            indexerId,
            contractAddress: log.address.toLowerCase(),
            contractName: source.name,
            blockNumber: log.blockNumber,
            blockHash: log.blockHash,
            transactionHash: log.transactionHash,
            logIndex: log.index,
            eventName: parsed.name,
            args: normalizeIndexedEventArgs(
              source.interface,
              parsed.name,
              parsed.args
            ),
          },
        },
        { upsert: true }
      );
      indexedEvents += 1;
    }

    const finalBlock = blocks[blocks.length - 1];
    await IndexerCheckpoint.findOneAndUpdate(
      { indexerId },
      {
        contractAddress,
        blockNumber: finalBlock.number,
        blockHash: finalBlock.hash,
      },
      { returnDocument: "after", upsert: true }
    );
    indexedBlocks += blocks.length;
  }
  return { indexedBlocks, indexedEvents };
};

const indexConfirmedEvents = () => {
  if (!indexingPromise) indexingPromise = runIndexingBatch().finally(() => { indexingPromise = null; });
  return indexingPromise;
};

const getIndexedEventsPage = async ({
  contractName,
  eventName,
  walletAddress,
  claimId,
  argRole,
  page = 1,
  limit = 50,
}) => {
  const normalizedPage = Math.max(Number(page) || 1, 1);
  const normalizedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const { indexerId } = await getIndexerContext(getProvider());
  const filter = { indexerId };
  if (eventName) filter.eventName = eventName;
  if (contractName) filter.contractName = contractName;
  if (claimId) filter["args.claimId"] = String(claimId);
  if (argRole) filter["args.role"] = String(argRole).toLowerCase();
  if (walletAddress) {
    const wallet = String(walletAddress).toLowerCase();
    filter.$or = [
      { "args.account": wallet },
      { "args.claimantWallet": wallet },
      { "args.holderWallet": wallet },
      { "args.actor": wallet },
    ];
  }
  const [items, total] = await Promise.all([
    IndexedBlockchainEvent.find(filter)
      .sort({ blockNumber: -1, logIndex: -1 })
      .skip((normalizedPage - 1) * normalizedLimit)
      .limit(normalizedLimit)
      .lean(),
    IndexedBlockchainEvent.countDocuments(filter),
  ]);
  return {
    items,
    pagination: {
      page: normalizedPage,
      limit: normalizedLimit,
      total,
      totalPages: Math.max(Math.ceil(total / normalizedLimit), 1),
    },
  };
};

const startBlockchainIndexer = async () => {
  if (process.env.INDEXER_ENABLED === "false" || indexerTimer) return;
  await ensureIndexerIndexes();
  await indexConfirmedEvents();
  indexerTimer = setInterval(() => {
    indexConfirmedEvents().catch((error) =>
      console.error("Blockchain indexer failed:", error.message)
    );
  }, Number(process.env.INDEXER_POLL_INTERVAL_MS || 15_000));
  indexerTimer.unref?.();
};

const stopBlockchainIndexer = () => {
  if (indexerTimer) clearInterval(indexerTimer);
  indexerTimer = null;
};

module.exports = {
  INDEXER_ID,
  ensureIndexerIndexes,
  eventIdentity,
  findReorgRollbackHeight,
  getIndexedSources,
  getIndexedEventsPage,
  indexConfirmedEvents,
  jsonSafe,
  migrateLegacyIndexedEventArgs,
  normalizeIndexedEventArgs,
  rollbackReorgs,
  startBlockchainIndexer,
  stopBlockchainIndexer,
};
