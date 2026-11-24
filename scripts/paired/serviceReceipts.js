const { ethers } = require("../../backEnd/node_modules/ethers");
const { canonicalReceipt } = require("./runner");
const { decodeEnvelope } = require("./receipt");

const serviceMethods = {
  BankIdentityRegistry: ["confirmEftTransfer"],
  OracleCoordinator: ["publishRegistrySnapshot", "commitOracleResult", "revealOracleResult"],
  ClaimAdjudicator: ["activateReview"],
  EvidenceRegistry: ["anchorEvidenceTreeHead", "setTreeHeadSigner"],
};

function isServiceTransaction(step) {
  return step.category !== "bootstrap" && (serviceMethods[step.target]?.includes(step.method) ?? false);
}

async function proveServiceReceipt({ provider, hash, contract, signer, eventName, matches, operationId }) {
  const reading = await canonicalReceipt(provider, hash);
  if (!reading) throw new Error("Missing receipt for service operation " + operationId);
  const { receipt, tx, block } = reading;
  const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
  if (BigInt(receipt.status) !== 1n || !same(block?.hash, receipt.blockHash) || !same(tx.blockHash, receipt.blockHash) ||
      !same(hash, tx.hash) || !same(hash, receipt.transactionHash) || !same(tx.to, contract.target) ||
      !same(tx.from, signer) || !decodeEnvelope(tx)) {
    throw new Error("Service transaction scope does not match " + operationId);
  }
  const matching = (receipt.logs ?? []).flatMap((log) => {
    if (!same(log.address, contract.target)) return [];
    const parsed = contract.interface.parseLog(log);
    return parsed?.name === eventName && matches(parsed.args) ? [parsed] : [];
  });
  if (matching.length !== 1) throw new Error("Receipt lacks one exact service event for " + operationId);
  return { operationId, transactionHash: tx.hash, blockHash: block.hash, blockNumber: Number(BigInt(block.number)),
    transactionIndex: Number(BigInt(receipt.transactionIndex)), effectiveGasPriceWei: String(BigInt(receipt.effectiveGasPrice ?? tx.gasPrice)),
    gasUsed: String(BigInt(receipt.gasUsed)), valueWei: String(BigInt(tx.value)), from: tx.from, to: tx.to };
}

async function collectWorkerReceipts({ provider, coordinator, requestId, requestBlock, workers, scope }) {
  if (workers.length !== 2 || new Set(workers.map((wallet) => ethers.getAddress(wallet))).size !== 2) {
    throw new Error("Exactly two distinct worker identities are required");
  }
  const types = [["commit", "OracleCommitmentSubmitted"], ["reveal", "OracleResultRevealed"]];
  const receipts = await Promise.all(types.flatMap(([phase, eventName]) => workers.map(async (worker, index) => {
    const operationId = scope + "." + phase + "-" + (index + 1);
    const filter = coordinator.filters[eventName](requestId, worker);
    const logs = await coordinator.queryFilter(filter, requestBlock);
    if (logs.length !== 1) throw new Error("Expected one canonical event for " + operationId);
    return proveServiceReceipt({ provider, hash: logs[0].transactionHash, contract: coordinator,
      signer: worker, eventName, operationId,
      matches: (args) => args.requestId === BigInt(requestId) && ethers.getAddress(args.oracle) === ethers.getAddress(worker) });
  })));
  if (new Set(receipts.map((row) => row.transactionHash)).size !== receipts.length) throw new Error("Duplicate worker transaction");
  return receipts;
}

module.exports = { collectWorkerReceipts, isServiceTransaction, proveServiceReceipt };
