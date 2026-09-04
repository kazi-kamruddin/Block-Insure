const crypto = require("crypto");
const { ethers } = require("ethers");

const Bank = require("../models/Bank");
const BankAccount = require("../models/BankAccount");
const BankOtpChallenge = require("../models/BankOtpChallenge");
const BankTransaction = require("../models/BankTransaction");
const EftMandate = require("../models/EftMandate");
const { getBankIdentityRegistry, getProvider, getReadOnlyContract } = require("./contractService");
const { notifyWallet } = require("./notificationService");

const BDT_MINOR_PER_ETH = 10_000_000;
const QUARTER_MS = 90 * 24 * 60 * 60 * 1000;
const EFT_RETRY_INTERVAL_MS = 60 * 60 * 1000;
const REMINDER_MIN_DAYS = 15;
const REMINDER_MAX_DAYS = 20;
const LOCAL_BANK_PRIVATE_KEY =
  "0x8166f546bab6da521a8369cab06c5d2b9e46670292d85c875ee9ec20e84ffb61";

let scheduler = null;
let transferQueue = Promise.resolve();

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeWallet = (value) => String(value || "").trim().toLowerCase();
const createInstructionKey = (walletAddress, policyId) => `${normalizeWallet(walletAddress)}:${policyId}`;
const createId = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const getOtpSecret = () => {
  const secret = String(process.env.BANK_OTP_SECRET || process.env.JWT_SECRET || "").trim();
  if (!secret) throw createError("BANK_OTP_SECRET or JWT_SECRET is not configured", 500);
  return secret;
};

const hashOtp = (challengeId, otp) =>
  crypto.createHmac("sha256", getOtpSecret()).update(`${challengeId}:${otp}`).digest("hex");

const otpMatches = (challenge, otp) => {
  const expected = Buffer.from(challenge.otpHash, "hex");
  const actual = Buffer.from(hashOtp(challenge.challengeId, otp), "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

const premiumWeiToMinor = (amountWei) => {
  const wei = BigInt(amountWei);
  const rounded = (wei * BigInt(BDT_MINOR_PER_ETH) + ethers.WeiPerEther / 2n) /
    ethers.WeiPerEther;
  if (rounded <= 0n || rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw createError("Policy premium cannot be represented in the bank ledger");
  }
  return Number(rounded);
};

const getReminderLeadDays = (dueAt, referenceDate = new Date()) =>
  Math.ceil((new Date(dueAt) - new Date(referenceDate)) / (24 * 60 * 60 * 1000));

const isReminderWindow = (dueAt, referenceDate = new Date()) => {
  const days = getReminderLeadDays(dueAt, referenceDate);
  return days >= REMINDER_MIN_DAYS && days <= REMINDER_MAX_DAYS;
};

const loadOwnedPolicy = async (walletAddress, policyId) => {
  if (!/^\d+$/.test(String(policyId || ""))) throw createError("A numeric policyId is required");
  const contract = getReadOnlyContract();
  let policy;
  try {
    policy = await contract.getPolicy(policyId);
  } catch {
    throw createError("Policy was not found", 404);
  }
  if (normalizeWallet(policy.holderWallet) !== normalizeWallet(walletAddress)) {
    throw createError("Policy belongs to another wallet", 403);
  }
  const status = Number(await contract.getEffectivePolicyStatus(policyId));
  if (![1, 2].includes(status)) throw createError("Policy is not active or in its grace period", 409);
  return {
    policy,
    amountWei: policy.premiumAmount.toString(),
    amountMinor: premiumWeiToMinor(policy.premiumAmount),
    nextDueAt: new Date(Number(policy.nextPremiumDueDate) * 1000),
  };
};

const loadOwnedAccount = async (walletAddress, accountReference) => {
  const account = await BankAccount.findOne({
    accountReference: String(accountReference || "").trim().toUpperCase(),
    ownerWalletAddress: normalizeWallet(walletAddress),
  });
  if (!account) throw createError("Bank account was not found for this wallet", 404);
  if (account.status !== "ACTIVE") throw createError("Bank account is not active", 409);
  return account;
};

const createMandate = async ({ walletAddress, accountReference, policyId, validFrom, validUntil }) => {
  const [account, policyDetails] = await Promise.all([
    loadOwnedAccount(walletAddress, accountReference),
    loadOwnedPolicy(walletAddress, policyId),
  ]);
  const start = validFrom ? new Date(validFrom) : policyDetails.nextDueAt;
  const end = new Date(validUntil);
  if (Number.isNaN(start.getTime())) throw createError("A valid mandate start date is required");
  if (Number.isNaN(end.getTime())) throw createError("A valid mandate end date is required");
  if (end <= start) throw createError("Mandate end date must be after its start date");

  const duplicate = await EftMandate.findOne({
    ownerWalletAddress: normalizeWallet(walletAddress),
    policyId: String(policyId),
    status: { $in: ["PENDING_BANK_APPROVAL", "ACTIVE"] },
  });
  if (duplicate) throw createError("This policy already has a pending or active EFT mandate", 409);

  let mandate;
  try {
    mandate = await EftMandate.create({
      mandateId: createId("EFT"),
      bankId: account.bankId,
      accountReference: account.accountReference,
      policyId: String(policyId),
      ownerWalletAddress: normalizeWallet(walletAddress),
      activeInstructionKey: createInstructionKey(walletAddress, policyId),
      destinationReference: "BLOCK-INSURE-PREMIUM-TREASURY",
      amountMinor: policyDetails.amountMinor,
      validFrom: start,
      validUntil: end,
    });
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.activeInstructionKey) {
      throw createError("This policy already has a pending or active EFT mandate", 409);
    }
    throw error;
  }
  const bank = await Bank.findOne({ bankId: account.bankId }).lean();
  if (bank?.walletAddress) {
    await notifyWallet(bank.walletAddress, {
      type: "EFT_MANDATE_REQUESTED",
      title: `New EFT mandate for policy #${policyId}`,
      message: `Review the quarterly standing instruction from account •••• ${account.lastFour}.`,
      policyId: String(policyId),
      status: mandate.status,
      link: "/bank/dashboard",
      dedupeKey: `eft-request:${mandate.mandateId}`,
    });
  }
  return mandate;
};

const approveMandate = async ({ bankId, bankWallet, mandateId }) => {
  const now = new Date();
  const mandate = await EftMandate.findOneAndUpdate(
    { mandateId, bankId, status: "PENDING_BANK_APPROVAL", validUntil: { $gt: now } },
    [{
      $set: {
        status: "ACTIVE",
        approvedAt: now,
        approvedByWallet: normalizeWallet(bankWallet),
        nextDebitAt: "$validFrom",
        activeInstructionKey: { $concat: ["$ownerWalletAddress", ":", "$policyId"] },
      },
    }],
    { returnDocument: "after", updatePipeline: true }
  );
  if (!mandate) {
    const expired = await EftMandate.findOneAndUpdate(
      { mandateId, bankId, status: "PENDING_BANK_APPROVAL", validUntil: { $lte: now } },
      { $set: { status: "EXPIRED" }, $unset: { activeInstructionKey: 1 } },
      { returnDocument: "after" }
    );
    if (expired) throw createError("EFT mandate has expired", 409);
    throw createError("Pending mandate was not found", 404);
  }
  await notifyWallet(mandate.ownerWalletAddress, {
    type: "EFT_MANDATE_APPROVED",
    title: `EFT mandate approved for policy #${mandate.policyId}`,
    message: `Quarterly automatic debits begin on ${mandate.nextDebitAt.toISOString().slice(0, 10)}. EFT debits do not require OTP.`,
    policyId: mandate.policyId,
    status: mandate.status,
    link: "/user/banking",
    dedupeKey: `eft-approved:${mandate.mandateId}`,
  });
  return mandate;
};

const rejectMandate = async ({ bankId, mandateId, reason }) => {
  const defaultReason = "Bank review declined the instruction";
  const rejectionReason = String(reason || defaultReason).trim() || defaultReason;
  if (rejectionReason.length > 500) throw createError("Rejection reason cannot exceed 500 characters");
  const mandate = await EftMandate.findOneAndUpdate(
    { mandateId, bankId, status: "PENDING_BANK_APPROVAL" },
    { $set: { status: "REJECTED", rejectedAt: new Date(), rejectionReason }, $unset: { activeInstructionKey: 1 } },
    { returnDocument: "after" }
  );
  if (!mandate) throw createError("Pending mandate was not found", 404);
  await notifyWallet(mandate.ownerWalletAddress, {
    type: "EFT_MANDATE_REJECTED",
    title: `EFT mandate rejected for policy #${mandate.policyId}`,
    message: mandate.rejectionReason,
    policyId: mandate.policyId,
    status: mandate.status,
    link: "/user/banking",
    dedupeKey: `eft-rejected:${mandate.mandateId}`,
  });
  return mandate;
};

const cancelMandate = async ({ walletAddress, mandateId }) => {
  const mandate = await EftMandate.findOneAndUpdate(
    { mandateId, ownerWalletAddress: normalizeWallet(walletAddress), status: { $in: ["PENDING_BANK_APPROVAL", "ACTIVE"] } },
    { $set: { status: "CANCELLED", cancelledAt: new Date() }, $unset: { activeInstructionKey: 1 } },
    { returnDocument: "after" }
  );
  if (!mandate) throw createError("Cancellable mandate was not found", 404);
  return mandate;
};

const getBankSigner = async () => {
  const provider = getProvider();
  const network = await provider.getNetwork();
  const configured = String(process.env.BANK_PRIVATE_KEY || "").trim();
  if (!configured && (network.chainId !== 31337n || process.env.NODE_ENV === "production")) {
    throw createError("BANK_PRIVATE_KEY is not configured", 500);
  }
  return new ethers.Wallet(configured || LOCAL_BANK_PRIVATE_KEY, provider);
};

const executeTransferInternal = async ({ account, policyId, amountMinor, amountWei, type, dueAt, mandateId = "" }) => {
  const transaction = await BankTransaction.create({
    transactionId: createId(type === "EFT" ? "EFT-TXN" : "OTP-TXN"),
    bankId: account.bankId,
    accountReference: account.accountReference,
    ownerWalletAddress: account.ownerWalletAddress,
    policyId: String(policyId),
    mandateId,
    type,
    amountMinor,
    amountWei,
    dueAt,
  });
  const debited = await BankAccount.findOneAndUpdate(
    { _id: account._id, status: "ACTIVE", balanceMinor: { $gte: amountMinor } },
    { $inc: { balanceMinor: -amountMinor } },
    { returnDocument: "after" }
  );
  if (!debited) {
    transaction.status = "FAILED";
    transaction.failureReason = "Insufficient account balance";
    transaction.completedAt = new Date();
    await transaction.save();
    await notifyWallet(account.ownerWalletAddress, {
      type: "BANK_PAYMENT_FAILED",
      title: `Premium payment failed for policy #${policyId}`,
      message: "The linked bank account does not have enough available balance.",
      policyId: String(policyId), status: "FAILED", link: "/user/banking",
      dedupeKey: `bank-payment-failed:${transaction.transactionId}`,
    });
    return transaction;
  }

  let receipt;
  try {
    const signer = await getBankSigner();
    const registry = getBankIdentityRegistry(signer);
    const referenceHash = ethers.id(transaction.transactionId);
    const instructionHash = ethers.id(mandateId || `MANUAL:${transaction.transactionId}`);
    const tx = await registry.confirmEftTransfer(
      policyId,
      account.ownerWalletAddress,
      amountWei,
      referenceHash,
      instructionHash
    );
    receipt = await tx.wait();
  } catch (error) {
    await BankAccount.updateOne({ _id: account._id }, { $inc: { balanceMinor: amountMinor } });
    transaction.status = "FAILED";
    transaction.failureReason = error.shortMessage || error.reason || error.message;
    transaction.completedAt = new Date();
    await transaction.save();
    await notifyWallet(account.ownerWalletAddress, {
      type: "BANK_PAYMENT_FAILED",
      title: `Premium payment failed for policy #${policyId}`,
      message: "The bank restored the reserved balance because the policy ledger rejected the transfer.",
      policyId: String(policyId), status: "FAILED", link: "/user/banking",
      dedupeKey: `bank-payment-failed:${transaction.transactionId}`,
    });
    return transaction;
  }

  // The chain confirmation is irreversible. Persist it outside the compensation
  // block so a later database/notification failure can never refund settled funds.
  transaction.status = "PAID";
  transaction.completedAt = new Date();
  transaction.transactionHash = receipt.hash;
  await transaction.save();
  await notifyWallet(account.ownerWalletAddress, {
    type: "PREMIUM_PAYMENT_CONFIRMED",
    title: `Bank payment confirmed for policy #${policyId}`,
    message: `${(amountMinor / 100).toFixed(2)} BDT was debited by ${type === "EFT" ? "quarterly EFT" : "manual OTP payment"}.`,
    policyId: String(policyId), transactionHash: receipt.hash, status: "PAID", link: `/user/payments?policyId=${policyId}`,
    dedupeKey: `bank-payment-paid:${transaction.transactionId}`,
  });
  return transaction;
};

const executeTransfer = (details) => {
  const pending = transferQueue.then(() => executeTransferInternal(details));
  transferQueue = pending.catch(() => undefined);
  return pending;
};

const runBankAutomation = async ({ bankId = "", referenceDate = new Date() } = {}) => {
  const now = new Date(referenceDate);
  if (Number.isNaN(now.getTime())) throw createError("Invalid automation reference date");
  const filter = { status: "ACTIVE", ...(bankId ? { bankId } : {}) };
  const mandates = await EftMandate.find(filter).sort({ nextDebitAt: 1 });
  const result = { referenceDate: now, reminders: 0, paid: 0, failed: 0, expired: 0, skipped: 0, errors: 0 };

  for (const mandate of mandates) {
    try {
      if (mandate.validUntil < now) {
        mandate.status = "EXPIRED";
        mandate.activeInstructionKey = undefined;
        await mandate.save();
        result.expired += 1;
        continue;
      }
      const daysUntilDue = getReminderLeadDays(mandate.nextDebitAt, now);
      if (!mandate.lastReminderAt && isReminderWindow(mandate.nextDebitAt, now)) {
        await notifyWallet(mandate.ownerWalletAddress, {
          type: "PREMIUM_DUE_REMINDER",
          title: `Automatic premium debit in ${daysUntilDue} days`,
          message: `${(mandate.amountMinor / 100).toFixed(2)} BDT will be debited for policy #${mandate.policyId}.`,
          policyId: mandate.policyId, status: "SCHEDULED", link: "/user/banking",
          dedupeKey: `eft-reminder:${mandate.mandateId}:${mandate.nextDebitAt.toISOString().slice(0, 10)}`,
        });
        mandate.lastReminderAt = now;
        await mandate.save();
        result.reminders += 1;
      }
      if (mandate.nextDebitAt > now) continue;
      const retryCutoff = new Date(now.getTime() - EFT_RETRY_INTERVAL_MS);
      const claimedMandate = await EftMandate.findOneAndUpdate(
        {
          _id: mandate._id,
          status: "ACTIVE",
          nextDebitAt: mandate.nextDebitAt,
          $or: [
            { lastAttemptAt: null },
            { lastAttemptAt: { $lte: retryCutoff } },
          ],
        },
        { $set: { lastAttemptAt: now } },
        { returnDocument: "after" }
      );
      if (!claimedMandate) {
        result.skipped += 1;
        continue;
      }
      const account = await BankAccount.findOne({
        bankId: claimedMandate.bankId,
        accountReference: claimedMandate.accountReference,
      });
      if (!account) {
        result.failed += 1;
        continue;
      }
      const policyDetails = await loadOwnedPolicy(claimedMandate.ownerWalletAddress, claimedMandate.policyId);
      const transfer = await executeTransfer({
        account, policyId: claimedMandate.policyId, amountMinor: claimedMandate.amountMinor,
        amountWei: policyDetails.amountWei, type: "EFT", dueAt: claimedMandate.nextDebitAt,
        mandateId: claimedMandate.mandateId,
      });
      claimedMandate.lastTransactionReference = transfer.transactionId;
      if (transfer.status === "PAID") {
        claimedMandate.lastDebitedAt = now;
        claimedMandate.lastReminderAt = null;
        claimedMandate.debitCount += 1;
        claimedMandate.nextDebitAt = new Date(claimedMandate.nextDebitAt.getTime() + QUARTER_MS);
        result.paid += 1;
      } else {
        result.failed += 1;
      }
      await claimedMandate.save();
    } catch (error) {
      result.errors += 1;
      console.warn(`EFT mandate ${mandate.mandateId} scan failed:`, error.message);
    }
  }
  return result;
};

const requestManualPaymentOtp = async ({ walletAddress, accountReference, policyId }) => {
  await Promise.all([loadOwnedAccount(walletAddress, accountReference), loadOwnedPolicy(walletAddress, policyId)]);
  const challengeId = createId("OTP");
  const otp = String(crypto.randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  await BankOtpChallenge.updateMany(
    {
      ownerWalletAddress: normalizeWallet(walletAddress),
      accountReference: String(accountReference || "").trim().toUpperCase(),
      policyId: String(policyId),
      status: "PENDING",
    },
    { $set: { status: "EXPIRED" } }
  );
  await BankOtpChallenge.create({
    challengeId, ownerWalletAddress: normalizeWallet(walletAddress),
    accountReference, policyId: String(policyId), otpHash: hashOtp(challengeId, otp), expiresAt,
  });
  return {
    challengeId,
    expiresAt,
    deliveryMessage: "A six-digit OTP was issued for this manual bank payment.",
    ...(process.env.NODE_ENV !== "production" ? { demoOtp: otp } : {}),
  };
};

const confirmManualPaymentOtp = async ({ walletAddress, challengeId, otp }) => {
  const challenge = await BankOtpChallenge.findOne({
    challengeId, ownerWalletAddress: normalizeWallet(walletAddress), status: "PENDING",
  }).select("+otpHash");
  if (!challenge) throw createError("Pending OTP challenge was not found", 404);
  if (challenge.expiresAt <= new Date()) {
    challenge.status = "EXPIRED";
    await challenge.save();
    throw createError("OTP has expired", 410);
  }
  if (!otpMatches(challenge, otp)) {
    challenge.attempts += 1;
    if (challenge.attempts >= 3) challenge.status = "LOCKED";
    await challenge.save();
    // A payment OTP is transaction validation, not wallet authentication.
    // Returning 401 would make the client discard an otherwise valid SIWE session.
    throw createError("Incorrect OTP", 422);
  }
  const [account, policyDetails] = await Promise.all([
    loadOwnedAccount(walletAddress, challenge.accountReference),
    loadOwnedPolicy(walletAddress, challenge.policyId),
  ]);
  const consumed = await BankOtpChallenge.findOneAndUpdate(
    { _id: challenge._id, status: "PENDING", expiresAt: { $gt: new Date() } },
    { $set: { status: "USED" } },
    { returnDocument: "after" }
  );
  if (!consumed) throw createError("OTP challenge was already used or expired", 409);
  return executeTransfer({
    account, policyId: challenge.policyId, amountMinor: policyDetails.amountMinor,
    amountWei: policyDetails.amountWei, type: "MANUAL_OTP", dueAt: new Date(),
  });
};

const startBankPaymentScheduler = () => {
  if (scheduler || process.env.NODE_ENV === "test") return;
  scheduler = setInterval(() => {
    runBankAutomation().catch((error) => console.warn("Bank payment scheduler failed:", error.message));
  }, 15 * 60 * 1000);
  scheduler.unref();
  runBankAutomation().catch((error) => console.warn("Initial bank payment scan failed:", error.message));
};

const stopBankPaymentScheduler = () => {
  if (scheduler) clearInterval(scheduler);
  scheduler = null;
};

module.exports = {
  BDT_MINOR_PER_ETH,
  approveMandate,
  cancelMandate,
  confirmManualPaymentOtp,
  createMandate,
  executeTransfer,
  getReminderLeadDays,
  isReminderWindow,
  premiumWeiToMinor,
  rejectMandate,
  requestManualPaymentOtp,
  runBankAutomation,
  startBankPaymentScheduler,
  stopBankPaymentScheduler,
};
