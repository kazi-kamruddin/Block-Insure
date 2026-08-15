const { ethers } = require("ethers");
const EvidenceTreeHead = require("../models/EvidenceTreeHead");
const {
  getConsistencyReceipt,
} = require("../services/evidenceTransparencyService");
const { anchorCurrentEvidenceTree } = require("../services/evidenceAnchorService");

const formatHead = (head) => ({
  treeSize: Number(head.treeSize),
  rootHash: `0x${head.rootHash}`,
  previousRootHash: head.previousRootHash
    ? `0x${head.previousRootHash}`
    : ethers.ZeroHash,
  signerWallet: head.signerWallet,
  signature: head.signature,
  anchorTransactionHash: head.anchorTransactionHash || "",
  anchorBlockNumber: head.anchorBlockNumber ?? null,
  createdAt: head.createdAt,
});

const anchorLatestTreeHead = async (req, res, next) => {
  try {
    const head = await anchorCurrentEvidenceTree();
    res.status(200).json({ success: true, treeHead: formatHead(head) });
  } catch (error) {
    next(error);
  }
};

const getLatestTreeHead = async (req, res, next) => {
  try {
    const head = await EvidenceTreeHead.findOne().sort({ treeSize: -1 }).lean();
    if (!head) return res.status(404).json({ success: false, message: "No evidence tree head exists" });
    res.status(200).json({ success: true, treeHead: formatHead(head) });
  } catch (error) {
    next(error);
  }
};

const getConsistencyProof = async (req, res, next) => {
  try {
    const receipt = await getConsistencyReceipt(
      Number(req.query.oldSize),
      Number(req.query.newSize)
    );
    res.status(200).json({
      success: true,
      oldTreeHead: formatHead(receipt.oldTreeHead),
      newTreeHead: formatHead(receipt.newTreeHead),
      consistencyProof: receipt.consistencyProof,
    });
  } catch (error) {
    error.statusCode ||= 400;
    next(error);
  }
};

module.exports = {
  anchorLatestTreeHead,
  getConsistencyProof,
  getLatestTreeHead,
};
