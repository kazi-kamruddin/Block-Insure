const { ethers } = require("ethers");
const {
  createSignedTreeHead,
} = require("./evidenceTransparencyService");
const {
  getAdminWallet,
  getEvidenceRegistry,
} = require("./contractService");

let anchorTimer = null;

const anchorCurrentEvidenceTree = async () => {
  const head = await createSignedTreeHead();
  if (head.anchorTransactionHash) return head;
  const signer = getAdminWallet();
  const registry = getEvidenceRegistry(signer);
  const trustedTreeHeadSigner = await registry.treeHeadSigner();
  if (trustedTreeHeadSigner.toLowerCase() !== head.signerWallet.toLowerCase()) {
    const signerUpdate = await registry.setTreeHeadSigner(head.signerWallet);
    await signerUpdate.wait();
  }
  const onChainSize = Number(await registry.currentTreeSize());
  const onChainRoot = await registry.currentRootHash();
  const rootHash = `0x${head.rootHash}`;
  const previousRootHash = head.previousRootHash
    ? `0x${head.previousRootHash}`
    : ethers.ZeroHash;

  if (onChainSize >= head.treeSize) {
    if (
      onChainSize !== head.treeSize ||
      onChainRoot.toLowerCase() !== rootHash.toLowerCase()
    ) {
      const error = new Error("On-chain evidence tree is ahead of the local log");
      error.statusCode = 409;
      throw error;
    }
    return head;
  }
  if (onChainRoot.toLowerCase() !== previousRootHash.toLowerCase()) {
    const error = new Error("Evidence tree predecessor is not anchored");
    error.statusCode = 409;
    throw error;
  }

  const transaction = await registry.anchorEvidenceTreeHead(
    head.treeSize,
    rootHash,
    previousRootHash,
    head.signature
  );
  const receipt = await transaction.wait();
  head.anchorTransactionHash = transaction.hash;
  head.anchorBlockNumber = Number(receipt.blockNumber);
  await head.save();
  return head;
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
    anchorCurrentEvidenceTree().catch((error) => {
      if (error.message !== "Cannot sign an empty evidence tree") {
        console.error("Evidence tree anchoring failed:", error.message);
      }
    });
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
