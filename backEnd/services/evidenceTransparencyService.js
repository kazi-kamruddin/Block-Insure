const crypto = require("crypto");
const { ethers } = require("ethers");
const EvidenceEvent = require("../models/EvidenceEvent");
const EvidenceTreeHead = require("../models/EvidenceTreeHead");

const EMPTY_ROOT = crypto.createHash("sha256").update(Buffer.alloc(0)).digest();

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])])
    );
  }
  return value instanceof Date ? value.toISOString() : value;
};

const canonicalize = (value) => JSON.stringify(stableValue(value));
const hashLeaf = (canonicalEvent) =>
  crypto
    .createHash("sha256")
    .update(Buffer.concat([Buffer.from([0]), Buffer.from(canonicalEvent)]))
    .digest();
const hashNode = (left, right) =>
  crypto
    .createHash("sha256")
    .update(Buffer.concat([Buffer.from([1]), left, right]))
    .digest();

const largestPowerOfTwoLessThan = (value) => {
  let power = 1;
  while ((power << 1) < value) power <<= 1;
  return power;
};

const merkleTreeHash = (leafHashes) => {
  if (leafHashes.length === 0) return EMPTY_ROOT;
  if (leafHashes.length === 1) return Buffer.from(leafHashes[0]);
  const split = largestPowerOfTwoLessThan(leafHashes.length);
  return hashNode(
    merkleTreeHash(leafHashes.slice(0, split)),
    merkleTreeHash(leafHashes.slice(split))
  );
};

const buildInclusionProof = (leafHashes, leafIndex) => {
  if (leafIndex < 0 || leafIndex >= leafHashes.length) {
    throw new Error("Leaf index is outside the tree");
  }
  const build = (leaves, index) => {
    if (leaves.length === 1) return [];
    const split = largestPowerOfTwoLessThan(leaves.length);
    if (index < split) {
      return [...build(leaves.slice(0, split), index), merkleTreeHash(leaves.slice(split))];
    }
    return [
      ...build(leaves.slice(split), index - split),
      merkleTreeHash(leaves.slice(0, split)),
    ];
  };
  return build(leafHashes, leafIndex);
};

const verifyInclusionProof = ({ leafHash, leafIndex, treeSize, proof, rootHash }) => {
  let index = leafIndex;
  let last = treeSize - 1;
  let calculated = Buffer.from(leafHash);
  for (const sibling of proof) {
    if ((index & 1) === 1 || index === last) {
      calculated = hashNode(Buffer.from(sibling), calculated);
      while ((index & 1) === 0 && index !== 0) {
        index >>= 1;
        last >>= 1;
      }
    } else {
      calculated = hashNode(calculated, Buffer.from(sibling));
    }
    index >>= 1;
    last >>= 1;
  }
  return calculated.equals(Buffer.from(rootHash));
};

const buildConsistencyProof = (leafHashes, oldSize) => {
  if (oldSize < 0 || oldSize > leafHashes.length) throw new Error("Invalid old tree size");
  if (oldSize === 0 || oldSize === leafHashes.length) return [];
  const subproof = (leaves, size, complete) => {
    if (size === leaves.length) return complete ? [] : [merkleTreeHash(leaves)];
    const split = largestPowerOfTwoLessThan(leaves.length);
    if (size <= split) {
      return [
        ...subproof(leaves.slice(0, split), size, complete),
        merkleTreeHash(leaves.slice(split)),
      ];
    }
    return [
      ...subproof(leaves.slice(split), size - split, false),
      merkleTreeHash(leaves.slice(0, split)),
    ];
  };
  return subproof(leafHashes, oldSize, true);
};

const verifyConsistencyProof = ({ oldSize, newSize, oldRoot, newRoot, proof }) => {
  if (oldSize === 0) return true;
  if (oldSize === newSize) return proof.length === 0 && Buffer.from(oldRoot).equals(Buffer.from(newRoot));
  if (oldSize > newSize || proof.length === 0) return false;
  let fn = oldSize - 1;
  let sn = newSize - 1;
  while ((fn & 1) === 1) {
    fn >>= 1;
    sn >>= 1;
  }
  let index = 0;
  let oldHash;
  let newHash;
  if (fn === 0) {
    oldHash = Buffer.from(oldRoot);
    newHash = Buffer.from(oldRoot);
  } else {
    oldHash = Buffer.from(proof[index]);
    newHash = Buffer.from(proof[index]);
    index += 1;
  }
  for (; index < proof.length; index += 1) {
    const node = Buffer.from(proof[index]);
    if (sn === 0) return false;
    if ((fn & 1) === 1 || fn === sn) {
      oldHash = hashNode(node, oldHash);
      newHash = hashNode(node, newHash);
      while (fn !== 0 && (fn & 1) === 0) {
        fn >>= 1;
        sn >>= 1;
      }
    } else {
      newHash = hashNode(newHash, node);
    }
    fn >>= 1;
    sn >>= 1;
  }
  return (
    sn === 0 &&
    oldHash.equals(Buffer.from(oldRoot)) &&
    newHash.equals(Buffer.from(newRoot))
  );
};

const loadLeafHashes = async (treeSize) => {
  const events = await EvidenceEvent.find({ treeIndex: { $lt: treeSize } })
    .sort({ treeIndex: 1 })
    .select("leafHash")
    .lean();
  if (events.length !== treeSize) throw new Error("Evidence log has an index gap");
  return events.map((event) => Buffer.from(event.leafHash, "hex"));
};

const appendEvidenceEvent = async (event) => {
  const eventWithTimestamp = {
    ...event,
    recordedAt: event.recordedAt || new Date().toISOString(),
  };
  const canonicalEvent = canonicalize(eventWithTimestamp);
  const leafHash = hashLeaf(canonicalEvent).toString("hex");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const latest = await EvidenceEvent.findOne().sort({ treeIndex: -1 }).select("treeIndex").lean();
    try {
      return await EvidenceEvent.create({
        treeIndex: latest ? latest.treeIndex + 1 : 0,
        eventType: eventWithTimestamp.eventType,
        claimId: String(eventWithTimestamp.claimId || ""),
        claimVersion: Number(eventWithTimestamp.claimVersion || 0),
        documentId: eventWithTimestamp.documentId || null,
        actorWallet: eventWithTimestamp.actorWallet,
        canonicalEvent,
        leafHash,
      });
    } catch (error) {
      if (error?.code !== 11000 || attempt === 4) throw error;
    }
  }
  throw new Error("Could not append evidence event");
};

const createSignedTreeHead = async () => {
  const treeSize = await EvidenceEvent.countDocuments();
  if (treeSize === 0) throw new Error("Cannot sign an empty evidence tree");
  const leaves = await loadLeafHashes(treeSize);
  const rootHash = merkleTreeHash(leaves);
  const previous = await EvidenceTreeHead.findOne().sort({ treeSize: -1 }).lean();
  const privateKey = process.env.EVIDENCE_LOG_SIGNER_PRIVATE_KEY || process.env.ADMIN_PRIVATE_KEY;
  if (!privateKey) throw new Error("Evidence log signer is not configured");
  const signer = new ethers.Wallet(privateKey);
  const registryAddress = process.env.EVIDENCE_REGISTRY_ADDRESS || ethers.ZeroAddress;
  const chainId = BigInt(process.env.CHAIN_ID || 31337);
  const previousRoot = previous?.rootHash
    ? `0x${previous.rootHash}`
    : ethers.ZeroHash;
  const digest = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "uint64", "bytes32", "bytes32"],
      [registryAddress, chainId, treeSize, `0x${rootHash.toString("hex")}`, previousRoot]
    )
  );
  const signature = await signer.signMessage(ethers.getBytes(digest));
  return EvidenceTreeHead.findOneAndUpdate(
    { treeSize },
    {
      $setOnInsert: {
        treeSize,
        rootHash: rootHash.toString("hex"),
        previousRootHash: previous?.rootHash || "",
        signerWallet: signer.address.toLowerCase(),
        signature,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

const getEvidenceReceipt = async (treeIndex) => {
  const head = await EvidenceTreeHead.findOne({ treeSize: { $gt: treeIndex } })
    .sort({ treeSize: 1 })
    .lean();
  if (!head) throw new Error("No signed tree head covers this event");
  const event = await EvidenceEvent.findOne({ treeIndex }).lean();
  if (!event) throw new Error("Evidence event not found");
  const leaves = await loadLeafHashes(head.treeSize);
  return {
    event,
    treeHead: head,
    inclusionProof: buildInclusionProof(leaves, treeIndex).map((hash) => hash.toString("hex")),
  };
};

const getConsistencyReceipt = async (oldSize, newSize) => {
  if (!Number.isInteger(oldSize) || !Number.isInteger(newSize) || oldSize < 1 || oldSize > newSize) {
    throw new Error("Invalid evidence tree sizes");
  }
  const [oldHead, newHead] = await Promise.all([
    EvidenceTreeHead.findOne({ treeSize: oldSize }).lean(),
    EvidenceTreeHead.findOne({ treeSize: newSize }).lean(),
  ]);
  if (!oldHead || !newHead) throw new Error("Signed tree head not found");
  const leaves = await loadLeafHashes(newSize);
  return {
    oldTreeHead: oldHead,
    newTreeHead: newHead,
    consistencyProof: buildConsistencyProof(leaves, oldSize).map((hash) =>
      hash.toString("hex")
    ),
  };
};

module.exports = {
  EMPTY_ROOT,
  appendEvidenceEvent,
  buildConsistencyProof,
  buildInclusionProof,
  canonicalize,
  createSignedTreeHead,
  getConsistencyReceipt,
  getEvidenceReceipt,
  hashLeaf,
  hashNode,
  merkleTreeHash,
  loadLeafHashes,
  verifyConsistencyProof,
  verifyInclusionProof,
};
