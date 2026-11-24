const { Interface, Transaction } = require("../../backEnd/node_modules/ethers");

const transferEvents = new Interface([
  "event SettlementWithdrawn(uint256 indexed claimId,address indexed claimant,uint256 amount,uint256 timestamp)",
  "event BenefitWithdrawn(address indexed beneficiary,uint256 amount)",
  "event PayoutFunded(uint256 indexed claimId,uint256 amount)",
  "event PayoutRecorded(uint256 indexed claimId,address indexed claimant,uint256 amount,bool funded)",
]);

const asWei = (value) => value == null ? null : BigInt(value).toString();

function transfersFromLogs(receipt, contracts, tx) {
  const result = [];
  const trusted = (actual, expected) => expected && actual?.toLowerCase() === expected.toLowerCase();
  for (const log of receipt.logs ?? []) {
    const manager = trusted(log.address, contracts.InsuranceManager);
    const benefits = trusted(log.address, contracts.PolicyBenefitsManager);
    const adjudicator = trusted(log.address, contracts.ClaimAdjudicator);
    if (!manager && !benefits && !adjudicator) continue;
    const event = transferEvents.parseLog(log);
    if (!event) continue;
    const { name, args } = event;
    if (manager && name === "SettlementWithdrawn") {
      result.push({ kind: "payout", from: contracts.ClaimAdjudicator, to: args[1], valueWei: asWei(args[2]) });
    }
    if (benefits && name === "BenefitWithdrawn") {
      result.push({ kind: "refund", from: contracts.PolicyBenefitsManager, to: args[0], valueWei: asWei(args[1]) });
    }
    if (adjudicator && (name === "PayoutFunded" || (name === "PayoutRecorded" && args[3]))) {
      result.push({ kind: "payout-allocation", from: contracts.InsuranceManager, to: log.address,
        valueWei: asWei(args[name === "PayoutFunded" ? 1 : 2]) });
    }
  }
  if (BigInt(tx.value ?? "0x0")) result.unshift({ kind: "transaction-value", from: tx.from, to: tx.to ?? receipt.contractAddress, valueWei: asWei(tx.value) });
  return result;
}

function decodeEnvelope(tx) {
  try {
    const envelope = Transaction.from({ ...tx, type: tx.type == null ? undefined : Number(tx.type), data: tx.input, gasLimit: tx.gas, signature: {
      r: tx.r, s: tx.s, v: tx.v, yParity: tx.yParity == null ? undefined : Number(tx.yParity),
    } });
    return envelope.hash?.toLowerCase() === tx.hash.toLowerCase() ? envelope : null;
  } catch { return null; }
}

function normalize({ step, manifestHash, chainId, receipt, tx, block, contracts, ledger, request, operatorFeeWei, captureLocalEncoding }) {
  const gas = BigInt(receipt.gasUsed);
  const gasPriceSource = receipt.effectiveGasPrice == null ? "transaction.gasPrice" : "receipt.effectiveGasPrice";
  const price = receipt.effectiveGasPrice ?? tx.gasPrice;
  const input = tx.input ?? "0x";
  const envelope = decodeEnvelope(tx);
  const serializedBytes = envelope ? (envelope.serialized.length - 2) / 2 : null;
  const unsignedBytes = envelope ? (envelope.unsignedSerialized.length - 2) / 2 : null;
  const successful = BigInt(receipt.status) === 1n;
  return {
    operationId: step.id, operationFingerprint: ledger.operationFingerprint, manifestHash, chainId: Number(chainId),
    signerRole: step.role, category: step.category, function: step.method,
    transactionHash: tx.hash, from: tx.from, to: tx.to ?? null, contractAddress: receipt.contractAddress ?? null,
    valueWei: asWei(tx.value), transfers: successful ? transfersFromLogs(receipt, contracts, tx) : [],
    status: successful ? "confirmed" : "reverted",
    blockNumber: Number(block.number), blockHash: block.hash,
    transactionIndex: receipt.transactionIndex == null ? null : Number(receipt.transactionIndex),
    blockTimestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
    gasUsed: asWei(gas), effectiveGasPriceWei: asWei(price), gasPriceSource: price == null ? null : gasPriceSource,
    executionFeeWei: price == null ? null : asWei(gas * BigInt(price)),
    l1DataFeeWei: asWei(receipt.l1Fee), operatorFeeWei: asWei(receipt.operatorFee ?? operatorFeeWei),
    operatorFeeSource: receipt.operatorFee != null ? "receipt.operatorFee" : operatorFeeWei != null ? "GasPriceOracle.getOperatorFee at receipt block" : null,
    evmExecutionGasUsed: asWei(receipt.executionGasUsed), stateGasUsed: asWei(receipt.stateGasUsed),
    calldataBytes: (input.length - 2) / 2, serializedBytes, unsignedBytes,
    ...(envelope && captureLocalEncoding
      ? { localSignedEnvelope: envelope.serialized } : {}),
    request: request ?? null,
    submissionToFirstReceiptMs: ledger.firstReceiptMs ?? null,
    observedFinalityUpperMs: ledger.finalityMs ?? null,
  };
}
module.exports = { decodeEnvelope, normalize, transfersFromLogs };

