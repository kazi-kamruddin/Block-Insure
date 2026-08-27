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
const CONFIRMATIONS = Number(process.env.INDEXER_CONFIRMATIONS || 3);
const CHUNK_SIZE = Number(process.env.INDEXER_CHUNK_SIZE || 500);
let indexerTimer = null;

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
  if (process.env.EVIDENCE_REGISTRY_ADDRESS) {
    configured.push([
      "EvidenceRegistry",
      process.env.EVIDENCE_REGISTRY_ADDRESS,
      EvidenceRegistryArtifact.abi,
    ]);
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
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value.toObject === "function") {
    return jsonSafe(value.toObject());
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => Number.isNaN(Number(key)))
        .map(([key, child]) => [key, jsonSafe(child)])
    );
  }
  return value;
};

const rollbackReorgs = async (provider) => {
  let latest = await IndexedBlock.findOne({ indexerId: INDEXER_ID }).sort({ blockNumber: -1 });
  while (latest) {
    const canonical = await provider.getBlock(latest.blockNumber);
    if (canonical?.hash === latest.blockHash) break;
    await Promise.all([
      IndexedBlockchainEvent.deleteMany({ blockNumber: { $gte: latest.blockNumber } }),
      IndexedBlock.deleteMany({ indexerId: INDEXER_ID, blockNumber: { $gte: latest.blockNumber } }),
    ]);
    latest = await IndexedBlock.findOne({ indexerId: INDEXER_ID }).sort({ blockNumber: -1 });
  }

  if (!latest) {
    await IndexerCheckpoint.deleteOne({ indexerId: INDEXER_ID });
    return null;
  }
  return IndexerCheckpoint.findOneAndUpdate(
    { indexerId: INDEXER_ID },
    {
      contractAddress: getContractAddress().toLowerCase(),
      blockNumber: latest.blockNumber,
      blockHash: latest.blockHash,
    },
    { new: true, upsert: true }
  );
};

const indexConfirmedEvents = async () => {
  const provider = getProvider();
  const contractAddress = getContractAddress().toLowerCase();
  const indexedSources = await getIndexedSources(provider);
  const checkpoint = await rollbackReorgs(provider);
  const latestBlock = await provider.getBlockNumber();
  const confirmedThrough = latestBlock - CONFIRMATIONS;
  let fromBlock = checkpoint
    ? checkpoint.blockNumber + 1
    : Number(process.env.CONTRACT_DEPLOYMENT_BLOCK || 0);
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
          filter: { indexerId: INDEXER_ID, blockNumber: block.number },
          update: {
            $setOnInsert: {
              indexerId: INDEXER_ID,
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
          contractAddress: log.address.toLowerCase(),
          transactionHash: log.transactionHash,
          logIndex: log.index,
        },
        {
          $setOnInsert: {
            contractAddress: log.address.toLowerCase(),
            contractName: source.name,
            blockNumber: log.blockNumber,
            blockHash: log.blockHash,
            transactionHash: log.transactionHash,
            logIndex: log.index,
            eventName: parsed.name,
            args: jsonSafe(parsed.args),
          },
        },
        { upsert: true }
      );
      indexedEvents += 1;
    }

    const finalBlock = blocks[blocks.length - 1];
    await IndexerCheckpoint.findOneAndUpdate(
      { indexerId: INDEXER_ID },
      {
        contractAddress,
        blockNumber: finalBlock.number,
        blockHash: finalBlock.hash,
      },
      { new: true, upsert: true }
    );
    indexedBlocks += blocks.length;
  }
  return { indexedBlocks, indexedEvents };
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
  const filter = {};
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
  eventIdentity,
  findReorgRollbackHeight,
  getIndexedSources,
  getIndexedEventsPage,
  indexConfirmedEvents,
  jsonSafe,
  rollbackReorgs,
  startBlockchainIndexer,
  stopBlockchainIndexer,
};
