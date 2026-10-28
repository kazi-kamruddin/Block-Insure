const crypto = require("node:crypto");
const { ethers } = require("ethers");
const Operation = require("../models/EvidenceOperation");
const { getDeploymentScope } = require("./deploymentScopeService");
const { getAdminWallet } = require("./contractService");

// This operator must not be used by unrelated external transaction producers.
// Store signed bytes before broadcast; an unknown response remains pending.
async function executeEvidenceOperation(key, populate, suppliedSigner) {
  const scope = await getDeploymentScope();
  const operationKey = `${scope}:${key}`;
  let operation;
  try { operation = await Operation.findOneAndUpdate({ operationKey }, { $setOnInsert: { operationKey, deploymentScope: scope } }, { upsert: true, returnDocument: "after" }); }
  catch (error) { if (error.code !== 11000) throw error; operation = await Operation.findOne({ operationKey }); }
  if (["CONFIRMED", "REVERTED"].includes(operation.status)) return operation;
  const leaseOwner = crypto.randomUUID();
  operation = await Operation.findOneAndUpdate({ _id: operation._id, status: { $in: ["PREPARING", "PENDING"] },
    $or: [{ leaseUntil: null }, { leaseUntil: { $lt: new Date() } }] },
  { $set: { leaseOwner, leaseUntil: new Date(Date.now() + 120000) } }, { returnDocument: "after" }).select("+signedTransaction");
  if (!operation) return Operation.findOne({ operationKey });
  try {
    const signer = suppliedSigner || getAdminWallet();
    const provider = signer.provider;
    if (!operation.signedTransaction) {
      const signerWallet = (await signer.getAddress()).toLowerCase();
      for (let attempt = 0; attempt < 5; attempt++) {
        const prior = await Operation.findOne({ deploymentScope: scope, signerWallet, nonce: { $ne: null } }).sort({ nonce: -1 });
        const nonce = Math.max(await provider.getTransactionCount(signerWallet, "pending"), prior ? prior.nonce + 1 : 0);
        const transaction = await signer.populateTransaction({ ...await populate(signer), nonce });
        const signedTransaction = await signer.signTransaction(transaction);
        try {
          operation = await Operation.findOneAndUpdate({ _id: operation._id, leaseOwner, transactionHash: "" }, { $set: {
            signedTransaction, transactionHash: ethers.keccak256(signedTransaction), nonce, signerWallet,
            nonceKey: `${scope}:${signerWallet}:${nonce}`, status: "PENDING",
          } }, { returnDocument: "after" }).select("+signedTransaction");
          if (!operation) throw new Error("Evidence operation lease changed");
          break;
        } catch (error) { if (error.code !== 11000 || attempt === 4) throw error; }
      }
    }
    let receipt = await provider.getTransactionReceipt(operation.transactionHash);
    if (!receipt) {
      try { await provider.broadcastTransaction(operation.signedTransaction); } catch { /* unknown outcome: retain exact signed transaction */ }
      receipt = await provider.getTransactionReceipt(operation.transactionHash);
    }
    if (receipt) {
      const confirmations = (await provider.getNetwork()).chainId === 31337n ? 1 : 12;
      if ((await provider.getBlockNumber()) - receipt.blockNumber + 1 >= confirmations &&
        (await provider.getBlock(receipt.blockNumber))?.hash === receipt.blockHash) {
        await Operation.updateOne({ _id: operation._id, leaseOwner }, { $set: { status: Number(receipt.status) === 1 ? "CONFIRMED" : "REVERTED" } });
      }
    }
    return Operation.findById(operation._id);
  } finally {
    if (operation) await Operation.updateOne({ _id: operation._id, leaseOwner }, { $set: { leaseOwner: "", leaseUntil: null } });
  }
}
module.exports = { executeEvidenceOperation };
