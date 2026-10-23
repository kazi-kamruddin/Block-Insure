const { calculateTextSHA256 } = require("./hashService");
const { getRegistryModel } = require("./oracleRegistryService");

const TREE_VERSION = "blockinsure-registry-merkle-v3";
const HASH_ALGORITHM = "SHA-256";
const treeCache = new Map();
const treeBuildPromises = new Map();
const archivedTreeCache = new Map();

const normalizeHash = (value) => String(value || "").trim().toLowerCase();

const withHexPrefix = (value) => {
  const normalizedValue = normalizeHash(value).replace(/^0x/, "");
  return normalizedValue ? `0x${normalizedValue}` : "";
};

const formatDate = (value) => {
  if (!value) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const hashText = (value) => withHexPrefix(calculateTextSHA256(value));

const stripHexPrefix = (value) => normalizeHash(value).replace(/^0x/, "");

const sortRecordsForTree = (records) => {
  return records.slice().sort((left, right) => {
    const leftKey = `${normalizeHash(left.invoiceHash)}-${left.invoiceNumber || ""}`;
    const rightKey = `${normalizeHash(right.invoiceHash)}-${right.invoiceNumber || ""}`;
    return leftKey.localeCompare(rightKey);
  });
};

const getCanonicalRecordPayload = (record) => ({
  hospitalId: record.hospitalId,
  hospitalName: record.hospitalName,
  licenseStatus: record.licenseStatus,
  patientHash: record.patientHash,
  ...(record.authorizedClaimants?.length ? { authorizedClaimants: [...record.authorizedClaimants].map((wallet) => wallet.toLowerCase()).sort() } : {}),
  treatmentType: record.treatmentType,
  diagnosisCode: record.diagnosisCode,
  admissionDate: formatDate(record.admissionDate),
  dischargeDate: formatDate(record.dischargeDate),
  invoiceDate: formatDate(record.invoiceDate),
  billAmount: record.billAmount,
  expectedBillMin: record.expectedBillMin,
  expectedBillMax: record.expectedBillMax,
  invoiceNumber: record.invoiceNumber,
  invoiceHash: normalizeHash(record.invoiceHash),
  invoiceStatus: record.invoiceStatus,
  recordStatus: record.recordStatus,
  fraudLabel: record.fraudLabel,
  datasetProfile: record.datasetProfile,
  baseDataOrigin: record.baseDataOrigin,
  claimSetting: record.claimSetting,
  providerPotentialFraud: record.providerPotentialFraud,
  providerLabelType: record.providerLabelType,
  scenarioInjected: record.scenarioInjected,
  scenarioType: record.scenarioType,
  scenarioVersion: record.scenarioVersion,
  sourceClaimAmountUsd: record.sourceClaimAmountUsd,
  sourceProcedureCode: record.sourceProcedureCode,
  amountNormalizationVersion: record.amountNormalizationVersion,
  amountNormalizationDivisor: record.amountNormalizationDivisor,
  previousClaimCount: record.previousClaimCount,
  providerVelocityAnomaly: record.providerVelocityAnomaly,
  claimantVelocityAnomaly: record.claimantVelocityAnomaly,
  nearDuplicateAdvisory: record.nearDuplicateAdvisory,
  isMissingOrNoisy: record.isMissingOrNoisy,
  dataQuality: record.dataQuality,
  recurringLegitimate: record.recurringLegitimate,
  fraudSignals: {
    usedInvoice: record.fraudSignals?.usedInvoice,
    cancelledRecord: record.fraudSignals?.cancelledRecord,
    inflatedAmount: record.fraudSignals?.inflatedAmount,
    blacklistedHospital: record.fraudSignals?.blacklistedHospital,
    dateMismatch: record.fraudSignals?.dateMismatch,
  },
});

const getCanonicalLeafInput = (record) => {
  return JSON.stringify(getCanonicalRecordPayload(record));
};

const buildLeaf = (record, sortedIndex) => ({
  sortedIndex,
  invoiceHash: normalizeHash(record.invoiceHash),
  invoiceNumber: record.invoiceNumber,
  hospitalId: record.hospitalId,
  leafHash: hashText(getCanonicalLeafInput(record)),
  canonicalRecord: getCanonicalRecordPayload(record),
});

const hashPair = (leftHash, rightHash) => {
  const pairInput = `${stripHexPrefix(leftHash)}${stripHexPrefix(rightHash)}`;
  return hashText(pairInput);
};

const buildMerkleLevels = (leaves) => {
  const levels = [leaves.map((leaf) => leaf.leafHash)];

  while (levels[levels.length - 1].length > 1) {
    const currentLevel = levels[levels.length - 1];
    const nextLevel = [];

    for (let index = 0; index < currentLevel.length; index += 2) {
      const leftHash = currentLevel[index];
      const rightHash = currentLevel[index + 1] || leftHash;
      nextLevel.push(hashPair(leftHash, rightHash));
    }

    levels.push(nextLevel);
  }

  return levels;
};

const getProofPath = (levels, leafIndex) => {
  const proof = [];
  let currentIndex = leafIndex;

  for (let levelIndex = 0; levelIndex < levels.length - 1; levelIndex += 1) {
    const level = levels[levelIndex];
    const isRightNode = currentIndex % 2 === 1;
    const siblingIndex = isRightNode ? currentIndex - 1 : currentIndex + 1;
    const siblingHash = level[siblingIndex] || level[currentIndex];

    proof.push({
      level: levelIndex,
      position: isRightNode ? "left" : "right",
      siblingHash,
    });

    currentIndex = Math.floor(currentIndex / 2);
  }

  return proof;
};

const verifyMerkleProof = ({ leafHash, proof, rootHash }) => {
  if (!leafHash || !rootHash) {
    return false;
  }

  let computedHash = leafHash;

  proof.forEach((step) => {
    computedHash =
      step.position === "left"
        ? hashPair(step.siblingHash, computedHash)
        : hashPair(computedHash, step.siblingHash);
  });

  return normalizeHash(computedHash) === normalizeHash(rootHash);
};

const buildMerkleTree = (records) => {
  const sortedRecords = sortRecordsForTree(records);
  const leaves = sortedRecords.map(buildLeaf);
  const levels = leaves.length > 0 ? buildMerkleLevels(leaves) : [[]];
  const rootHash = levels[levels.length - 1][0] || "";

  return {
    treeVersion: TREE_VERSION,
    hashAlgorithm: HASH_ALGORITHM,
    leafCount: leaves.length,
    treeDepth: Math.max(levels.length - 1, 0),
    rootHash,
    leaves,
    levels,
    leafByInvoiceHash: new Map(
      leaves.map((leaf) => [normalizeHash(leaf.invoiceHash), leaf])
    ),
  };
};

const getRegistryRecordsForMerkle = async (registrySnapshot = "primary") => {
  const RegistryModel = getRegistryModel(registrySnapshot);

  return RegistryModel.find()
    .select(
      "hospitalId hospitalName licenseStatus patientHash authorizedClaimants treatmentType diagnosisCode admissionDate dischargeDate invoiceDate billAmount expectedBillMin expectedBillMax invoiceNumber invoiceHash invoiceStatus recordStatus fraudLabel datasetProfile baseDataOrigin claimSetting providerPotentialFraud providerLabelType scenarioInjected scenarioType scenarioVersion sourceClaimAmountUsd sourceProcedureCode amountNormalizationVersion amountNormalizationDivisor previousClaimCount providerVelocityAnomaly claimantVelocityAnomaly nearDuplicateAdvisory isMissingOrNoisy dataQuality recurringLegitimate fraudSignals"
    )
    .lean();
};

const invalidateRegistryMerkleCache = (registrySnapshot) => {
  if (registrySnapshot) {
    treeCache.delete(registrySnapshot);
    treeBuildPromises.delete(registrySnapshot);
    return;
  }
  treeCache.clear();
  treeBuildPromises.clear();
};

const getCachedRegistryTree = async (registrySnapshot = "primary") => {
  if (treeCache.has(registrySnapshot)) return treeCache.get(registrySnapshot);
  if (treeBuildPromises.has(registrySnapshot)) return treeBuildPromises.get(registrySnapshot);

  const buildPromise = getRegistryRecordsForMerkle(registrySnapshot)
    .then((records) => {
      const tree = buildMerkleTree(records);
      treeCache.set(registrySnapshot, tree);
      return tree;
    })
    .finally(() => treeBuildPromises.delete(registrySnapshot));
  treeBuildPromises.set(registrySnapshot, buildPromise);
  return buildPromise;
};

const buildRegistryMerkleRoot = async (registrySnapshot = "primary") => {
  const tree = await getCachedRegistryTree(registrySnapshot);

  return {
    treeVersion: tree.treeVersion,
    hashAlgorithm: tree.hashAlgorithm,
    rootHash: tree.rootHash,
    leafCount: tree.leafCount,
    treeDepth: tree.treeDepth,
    generatedAt: new Date().toISOString(),
  };
};

const exportMerkleRoot = async () => {
  const merkleRoot = await buildRegistryMerkleRoot();
  return merkleRoot.rootHash || `0x${"0".repeat(64)}`;
};

const buildRegistryMerkleProof = async ({ invoiceHash, registrySnapshot = "primary", rootHash = "" }) => {
  let tree;
  if (rootHash) {
    tree = archivedTreeCache.get(normalizeHash(rootHash));
    const chunks = tree ? [] : await require("../models/RegistrySnapshotChunk").find({ rootHash: normalizeHash(rootHash) }).sort({ chunkIndex: 1 }).lean();
    if (chunks.length) {
      tree = buildMerkleTree(chunks.flatMap((chunk) => chunk.records));
      if (normalizeHash(tree.rootHash) !== normalizeHash(rootHash)) throw new Error("Archived registry snapshot is corrupt");
      archivedTreeCache.set(normalizeHash(rootHash), tree);
      if (archivedTreeCache.size > 3) archivedTreeCache.delete(archivedTreeCache.keys().next().value);
    }
  }
  tree ||= await getCachedRegistryTree(registrySnapshot);
  if (rootHash && normalizeHash(tree.rootHash) !== normalizeHash(rootHash)) {
    const error = new Error("Requested registry snapshot is unavailable");
    error.statusCode = 409;
    throw error;
  }
  const normalizedInvoiceHash = normalizeHash(invoiceHash);
  const leaf = tree.leafByInvoiceHash.get(normalizedInvoiceHash);

  if (!leaf) {
    return {
      treeVersion: tree.treeVersion,
      hashAlgorithm: tree.hashAlgorithm,
      rootHash: tree.rootHash,
      leafCount: tree.leafCount,
      treeDepth: tree.treeDepth,
      invoiceHash: normalizedInvoiceHash,
      found: false,
      verified: false,
      proof: [],
      generatedAt: new Date().toISOString(),
    };
  }

  const proof = getProofPath(tree.levels, leaf.sortedIndex);
  const verified = verifyMerkleProof({
    leafHash: leaf.leafHash,
    proof,
    rootHash: tree.rootHash,
  });

  return {
    treeVersion: tree.treeVersion,
    hashAlgorithm: tree.hashAlgorithm,
    rootHash: tree.rootHash,
    leafHash: leaf.leafHash,
    leafIndex: leaf.sortedIndex,
    leafCount: tree.leafCount,
    treeDepth: tree.treeDepth,
    proofLength: proof.length,
    invoiceHash: leaf.invoiceHash,
    invoiceNumber: leaf.invoiceNumber,
    hospitalId: leaf.hospitalId,
    found: true,
    verified,
    proof,
    canonicalRecord: leaf.canonicalRecord,
    safeRegistrySummary: {
      hospitalId: leaf.hospitalId,
      invoiceNumber: leaf.invoiceNumber,
      invoiceHash: leaf.invoiceHash,
      treatmentType: leaf.canonicalRecord.treatmentType,
      recordStatus: leaf.canonicalRecord.recordStatus,
      invoiceStatus: leaf.canonicalRecord.invoiceStatus,
      licenseStatus: leaf.canonicalRecord.licenseStatus,
      fraudLabel: leaf.canonicalRecord.fraudLabel,
      datasetProfile: leaf.canonicalRecord.datasetProfile,
      baseDataOrigin: leaf.canonicalRecord.baseDataOrigin,
      claimSetting: leaf.canonicalRecord.claimSetting,
      providerPotentialFraud: leaf.canonicalRecord.providerPotentialFraud,
      scenarioInjected: leaf.canonicalRecord.scenarioInjected,
      scenarioType: leaf.canonicalRecord.scenarioType,
    },
    generatedAt: new Date().toISOString(),
  };
};

module.exports = {
  TREE_VERSION,
  buildMerkleTree,
  buildRegistryMerkleProof,
  buildRegistryMerkleRoot,
  exportMerkleRoot,
  getCachedRegistryTree,
  getProofPath,
  getCanonicalRecordPayload,
  invalidateRegistryMerkleCache,
  verifyMerkleProof,
};
