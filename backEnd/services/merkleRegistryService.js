const { calculateTextSHA256 } = require("./hashService");
const { getRegistryModel } = require("./oracleRegistryService");

const TREE_VERSION = "phase-6-registry-merkle-v1";
const HASH_ALGORITHM = "SHA-256";

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
  };
};

const getRegistryRecordsForMerkle = async (registrySnapshot = "primary") => {
  const RegistryModel = getRegistryModel(registrySnapshot);

  return RegistryModel.find()
    .select(
      "hospitalId hospitalName licenseStatus patientHash treatmentType diagnosisCode admissionDate dischargeDate invoiceDate billAmount expectedBillMin expectedBillMax invoiceNumber invoiceHash invoiceStatus recordStatus fraudLabel"
    )
    .lean();
};

const buildRegistryMerkleRoot = async (registrySnapshot = "primary") => {
  const records = await getRegistryRecordsForMerkle(registrySnapshot);
  const tree = buildMerkleTree(records);

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

const buildRegistryMerkleProof = async ({ invoiceHash, registrySnapshot = "primary" }) => {
  const records = await getRegistryRecordsForMerkle(registrySnapshot);
  const tree = buildMerkleTree(records);
  const normalizedInvoiceHash = normalizeHash(invoiceHash);
  const leaf = tree.leaves.find(
    (item) => normalizeHash(item.invoiceHash) === normalizedInvoiceHash
  );

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
    },
    generatedAt: new Date().toISOString(),
  };
};

module.exports = {
  buildMerkleTree,
  buildRegistryMerkleProof,
  buildRegistryMerkleRoot,
  exportMerkleRoot,
  getCanonicalRecordPayload,
  verifyMerkleProof,
};
