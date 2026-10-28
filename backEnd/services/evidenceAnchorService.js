const { ethers } = require("ethers");
const {
  createSignedTreeHead,
} = require("./evidenceTransparencyService");
const {
  getAdminWallet,
  getEvidenceRegistry,
} = require("./contractService");

let anchorTimer = null;
let anchoring = false;

const anchorCurrentEvidenceTree = async () => {
  await require("./evidenceBundleService").assertEvidenceDeployment();
  const Head = require("../models/EvidenceTreeHead");
  const { executeEvidenceOperation } = require("./evidenceOperationService");
  const latest = await createSignedTreeHead();
  const signer = getAdminWallet();
  const registry = getEvidenceRegistry(signer);
  for (const head of await Head.find({ treeSize: { $lte: latest.treeSize } }).sort({ treeSize: 1 })) {
    const size = Number(await registry.currentTreeSize());
    const rootHash = `0x${head.rootHash}`;
    if (size >= head.treeSize) {
      const anchored = await registry.getTreeHead(head.treeSize);
      if (anchored.rootHash.toLowerCase() !== rootHash.toLowerCase()) throw new Error("Stored evidence head differs from the canonical anchor");
      const block = Number(anchored.anchoredBlock);
      const events = await registry.queryFilter(registry.filters.EvidenceTreeHeadAnchored(head.treeSize), block, block);
      head.anchorTransactionHash = events[0]?.transactionHash || head.anchorTransactionHash;
      head.anchorBlockNumber = block;
      head.anchorVerified = true;
      await head.save();
      continue;
    }
    if ((await registry.treeHeadSigner()).toLowerCase() !== head.signerWallet.toLowerCase()) {
      const update = await executeEvidenceOperation(`tree-signer:${head.signerWallet}`, async () => registry.setTreeHeadSigner.populateTransaction(head.signerWallet), signer);
      if (update.status !== "CONFIRMED") return latest;
    }
    const previous = head.previousRootHash ? `0x${head.previousRootHash}` : ethers.ZeroHash;
    if ((await registry.currentRootHash()).toLowerCase() !== previous.toLowerCase()) throw new Error("Evidence predecessor is not yet canonical; retain ordered recovery");
    const operation = await executeEvidenceOperation(`evidence-anchor:${head.treeSize}:${head.rootHash}`,
      async () => registry.anchorEvidenceTreeHead.populateTransaction(head.treeSize, rootHash, previous, head.signature), signer);
    if (operation.status !== "CONFIRMED") return latest;
    const receipt = await signer.provider.getTransactionReceipt(operation.transactionHash);
    head.anchorTransactionHash = operation.transactionHash;
    head.anchorBlockNumber = Number(receipt.blockNumber);
    head.anchorVerified = true;
    await head.save();
  }
  return Head.findById(latest._id);
};

const startEvidenceAnchorScheduler = () => {
  if (
    anchorTimer ||
    process.env.EVIDENCE_AUTO_ANCHOR === "false" ||
    !process.env.EVIDENCE_REGISTRY_ADDRESS
  ) {
    return;
  }
  anchorTimer = setInterval(() => {
    if (anchoring) return;
    anchoring = true;
    anchorCurrentEvidenceTree().catch((error) => {
      if (error.message !== "Cannot sign an empty evidence tree") {
        console.error("Evidence tree anchoring failed:", error.message);
      }
    }).finally(() => { anchoring = false; });
  }, Number(process.env.EVIDENCE_ANCHOR_INTERVAL_MS || 300_000));
  anchorTimer.unref?.();
};

const stopEvidenceAnchorScheduler = () => {
  if (anchorTimer) clearInterval(anchorTimer);
  anchorTimer = null;
};

module.exports = {
  anchorCurrentEvidenceTree,
  startEvidenceAnchorScheduler,
  stopEvidenceAnchorScheduler,
};
