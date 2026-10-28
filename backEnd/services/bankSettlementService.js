const crypto = require("node:crypto");
const { ethers } = require("ethers");
const Account = require("../models/BankAccount");
const Transaction = require("../models/BankTransaction");
const { getProvider, getBankIdentityRegistry, getReadOnlyContract } = require("./contractService");
const { getDeploymentScope } = require("./deploymentScopeService");
const { notifyWallet } = require("./notificationService");
const Mandate = require("../models/EftMandate");

const fail = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
const markerFor = (operation) => `settlementReservations.${operation.transactionId}`;
const reconcileMandateReceipt = async (operation) => {
  if (operation.status !== "PAID" || !operation.mandateId) return;
  const policy = await getReadOnlyContract().getPolicy(operation.policyId);
  await Mandate.updateOne({ mandateId: operation.mandateId, deploymentScope: operation.deploymentScope,
    settledTransferReferences: { $ne: operation.transactionId } }, {
    $addToSet: { settledTransferReferences: operation.transactionId }, $inc: { debitCount: 1 },
    $set: { lastDebitedAt: operation.completedAt, lastTransactionReference: operation.transactionId,
      nextDebitAt: new Date(Number(policy.nextPremiumDueDate) * 1000), lastReminderAt: null },
  });
};

// Conditional account mutations make retries safe across a crash between two
// documents. Unknown chain outcomes retain the reservation until reconciliation.
const refundOperation = async (operation, reason) => {
  const marker = markerFor(operation);
  await Account.updateOne({ accountReference: operation.accountReference, [`${marker}.state`]: "RESERVED" }, {
    $inc: { balanceMinor: operation.amountMinor }, $set: { [`${marker}.state`]: "REFUNDED" },
  });
  await Transaction.updateOne({ _id: operation._id, status: "PROCESSING" }, {
    $set: { status: "FAILED", stage: "REFUNDED", failureReason: reason, completedAt: new Date() }, $unset: { operationKey: 1 },
  });
};

const reconcileOperation = async (operation, { signer } = {}) => {
  if (operation.deploymentScope !== await getDeploymentScope()) throw fail("Payment belongs to a different deployment.");
  if (operation.status !== "PROCESSING") { await reconcileMandateReceipt(operation); return operation; }
  const leaseOwner = crypto.randomUUID();
  const locked = await Transaction.findOneAndUpdate({ _id: operation._id, status: "PROCESSING", $or: [
    { leaseUntil: { $exists: false } }, { leaseUntil: null }, { leaseUntil: { $lte: new Date() } },
  ] }, { $set: { leaseOwner, leaseUntil: new Date(Date.now() + 120000) } }, { returnDocument: "after" }).select("+signedTransaction");
  if (!locked) return Transaction.findById(operation._id);
  operation = locked;
  const marker = markerFor(operation);
  try {
    if (!operation.signedTransaction) {
      const reserved = await Account.findOneAndUpdate({ accountReference: operation.accountReference,
        ownerWalletAddress: operation.ownerWalletAddress, status: "ACTIVE", balanceMinor: { $gte: operation.amountMinor },
        [marker]: { $exists: false },
      }, { $inc: { balanceMinor: -operation.amountMinor }, $set: { [marker]: { amountMinor: operation.amountMinor, state: "RESERVED" } } },
      { returnDocument: "after" });
      if (!reserved) {
        const account = await Account.findOne({ accountReference: operation.accountReference }).select("+settlementReservations");
        const prior = account?.settlementReservations?.get(operation.transactionId);
        if (prior?.state !== "RESERVED") {
          await refundOperation(operation, prior?.state === "REFUNDED" ? "Previously refunded reservation" : "Insufficient available balance or inactive account");
          return Transaction.findById(operation._id);
        }
      }
      await Transaction.updateOne({ _id: operation._id, leaseOwner }, { $set: { stage: "RESERVED" } });
      try {
        if (!signer) throw fail("Gateway signer unavailable; reserved simulated funds restored.");
        const provider = getProvider();
        const registry = getBankIdentityRegistry(signer);
        const wallet = (await signer.getAddress()).toLowerCase();
        for (let attempt = 0; attempt < 5; attempt++) {
          const [pendingNonce, previous] = await Promise.all([
            provider.getTransactionCount(wallet, "pending"),
            Transaction.findOne({ deploymentScope: operation.deploymentScope, gatewayWallet: wallet, nonce: { $ne: null } }).sort({ nonce: -1 }).select("nonce").lean(),
          ]);
          const nonce = Math.max(pendingNonce, previous ? previous.nonce + 1 : 0);
          const request = await registry.confirmEftTransfer.populateTransaction(operation.policyId, operation.ownerWalletAddress,
            operation.installmentId, ethers.id(operation.transactionId), ethers.id(operation.mandateId || `MANUAL:${operation.transactionId}`),
            { value: BigInt(operation.amountWei), nonce });
          const populated = await signer.populateTransaction(request);
          const fee = BigInt(populated.gasLimit) * BigInt(populated.maxFeePerGas ?? populated.gasPrice);
          if (await provider.getBalance(wallet) < BigInt(operation.amountWei) + fee) throw fail("Gateway needs test ETH for settlement and gas.");
          const raw = await signer.signTransaction(populated);
          try {
            const saved = await Transaction.findOneAndUpdate({ _id: operation._id, leaseOwner, transactionHash: "" }, { $set: {
              signedTransaction: raw, transactionHash: ethers.keccak256(raw), stage: "SIGNED", gatewayWallet: wallet,
              nonce, nonceKey: `${operation.deploymentScope}:${wallet}:${nonce}`,
            } }, { returnDocument: "after" }).select("+signedTransaction");
            if (!saved) throw fail("Payment lease changed. Reconciliation required.");
            operation = saved; break;
          } catch (error) { if (error.code !== 11000 || attempt === 4) throw error; }
        }
      } catch {
        // No signed transaction was durably recorded: nothing was broadcast.
        // A database write may have succeeded despite a lost acknowledgement.
        const saved = await Transaction.findById(operation._id).select("+signedTransaction");
        if (!saved?.signedTransaction) {
          await refundOperation(operation, "Gateway could not prepare settlement. Check test ETH funding, installment availability and RPC readiness.");
          return Transaction.findById(operation._id);
        }
        operation = saved;
      }
    }
    const provider = getProvider();
    let receipt = await provider.getTransactionReceipt(operation.transactionHash);
    if (!receipt) {
      // Re-broadcast exactly the stored signed bytes; never invent a replacement
      // debit/reference/nonce after an ambiguous RPC response or restart.
      try { await provider.broadcastTransaction(operation.signedTransaction); } catch { /* outcome remains unknown */ }
      await Transaction.updateOne({ _id: operation._id, status: "PROCESSING" }, { $set: { stage: "PENDING" } });
      receipt = await provider.getTransactionReceipt(operation.transactionHash);
    }
    if (!receipt) return Transaction.findById(operation._id);
    const confirmations = Number(process.env.BANK_SETTLEMENT_CONFIRMATIONS || ((await provider.getNetwork()).chainId === 31337n ? 1 : 12));
    if (!Number.isSafeInteger(confirmations) || confirmations < 1) throw fail("BANK_SETTLEMENT_CONFIRMATIONS must be a positive integer.");
    if ((await provider.getBlockNumber()) - receipt.blockNumber + 1 < confirmations) return Transaction.findById(operation._id);
    const block = await provider.getBlock(receipt.blockNumber);
    if (block?.hash !== receipt.blockHash) return Transaction.findById(operation._id);
    if (Number(receipt.status) === 0) {
      await refundOperation(operation, "Settlement reverted; reserved simulated BDT restored.");
    } else {
      await Account.updateOne({ accountReference: operation.accountReference, [`${marker}.state`]: "RESERVED" }, { $set: { [`${marker}.state`]: "SETTLED" } });
      await Transaction.updateOne({ _id: operation._id, status: "PROCESSING" }, { $set: {
        status: "PAID", stage: "SETTLED", completedAt: new Date(), failureReason: "",
      } });
    }
    const result = await Transaction.findById(operation._id);
    await reconcileMandateReceipt(result);
    return result;
  } finally {
    await Transaction.updateOne({ _id: operation._id, leaseOwner }, { $unset: { leaseOwner: 1, leaseUntil: 1 } });
  }
};

const createSettlement = async (details, signer) => {
  const { account, policyId, installmentId, amountWei, amountMinor, dueAt, mandateId = "", type } = details;
  if (!/^[1-9]\d*$/.test(String(installmentId)) || !Number.isSafeInteger(amountMinor) || amountMinor < 1) throw fail("An exact installment quote is required.");
  const deploymentScope = await getDeploymentScope();
  if (type === "EFT") {
    const block = await getProvider().getBlock("latest");
    const now = new Date(Number(block.timestamp) * 1000);
    if (now < new Date(dueAt) || !await Mandate.exists({ mandateId, deploymentScope, accountReference: account.accountReference,
      ownerWalletAddress: account.ownerWalletAddress, status: "ACTIVE", validFrom: { $lte: now }, validUntil: { $gte: now } })) {
      throw fail("The standing instruction is cancelled, outside its validity or not yet due.");
    }
  }
  const operationKey = `${deploymentScope}:${policyId}:${installmentId}`;
  let operation;
  try { operation = await Transaction.create({ transactionId: `PAY-${crypto.randomUUID()}`, deploymentScope, operationKey,
    bankId: account.bankId, accountReference: account.accountReference, ownerWalletAddress: account.ownerWalletAddress,
    policyId: String(policyId), installmentId: String(installmentId), amountWei, amountMinor, dueAt, mandateId, type }); }
  catch (error) {
    if (error.code !== 11000) throw error;
    operation = await Transaction.findOne({ operationKey });
    if (!operation || operation.ownerWalletAddress !== account.ownerWalletAddress || operation.accountReference !== account.accountReference) {
      throw fail("This installment already has a bank operation. Check its receipt before retrying.");
    }
  }
  return reconcileOperation(operation, { signer });
};

const reconcilePendingSettlements = async (signer) => {
  const scope = await getDeploymentScope();
  const pending = await Transaction.find({ deploymentScope: scope, status: "PROCESSING" }).sort({ createdAt: 1 }).limit(100);
  const results = [];
  for (const operation of pending) results.push(await reconcileOperation(operation, { signer }));
  for (const operation of await Transaction.find({ deploymentScope: scope, status: { $in: ["PAID", "FAILED"] }, notificationPending: true }).limit(100)) {
    await reconcileMandateReceipt(operation);
    const notification = await notifyWallet(operation.ownerWalletAddress, {
      type: operation.status === "PAID" ? "PREMIUM_PAYMENT_CONFIRMED" : "BANK_PAYMENT_FAILED",
      title: `Bank installment #${operation.installmentId}: ${operation.status.toLowerCase()}`,
      message: operation.status === "PAID" ? `${(operation.amountMinor / 100).toFixed(2)} simulated BDT charged; ${ethers.formatEther(operation.amountWei)} test ETH settled.` : operation.failureReason,
      policyId: operation.policyId, transactionHash: operation.transactionHash, status: operation.status, link: "/user/banking",
      dedupeKey: `bank-payment-${operation.status.toLowerCase()}:${operation.transactionId}`,
    });
    if (notification) await Transaction.updateOne({ _id: operation._id }, { $set: { notificationPending: false } });
  }
  return results;
};
module.exports = { createSettlement, reconcileOperation, reconcilePendingSettlements };
