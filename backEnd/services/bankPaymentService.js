const crypto = require("crypto");
const { ethers } = require("ethers");

const Bank = require("../models/Bank");
const BankAccount = require("../models/BankAccount");
const BankOtpChallenge = require("../models/BankOtpChallenge");
const BankTransaction = require("../models/BankTransaction");
const EftMandate = require("../models/EftMandate");
const { getBankIdentityRegistry, getProvider, getReadOnlyContract } = require("./contractService");
const { notifyWallet } = require("./notificationService");
const { deliveryMode, deliverOtp } = require("./otpDeliveryService");
const { reserveDelivery } = require("./emailVerificationService");
const User = require("../models/User");
const { getPolicyEconomics } = require("./contractService");
const { getDeploymentScope } = require("./deploymentScopeService");
const { createSettlement, reconcilePendingSettlements } = require("./bankSettlementService");

const BDT_MINOR_PER_ETH = 10_000_000;
const EFT_RETRY_INTERVAL_MS = 60 * 60 * 1000;
const REMINDER_MIN_DAYS = 15;
const REMINDER_MAX_DAYS = 20;
const LOCAL_BANK_PRIVATE_KEY =
  "0x8166f546bab6da521a8369cab06c5d2b9e46670292d85c875ee9ec20e84ffb61";

let scheduler = null;
let reconciliationScheduler = null;
let transferQueue = Promise.resolve();

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeWallet = (value) => String(value || "").trim().toLowerCase();
const createInstructionKey = async (walletAddress, policyId) => `${await getDeploymentScope()}:${normalizeWallet(walletAddress)}:${policyId}`;
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
  const economics = await getPolicyEconomics(contract);
  const quote = await economics.getInstallmentQuote(policyId, policy.nextPremiumDueDate);
  if (quote.installmentId === 0n) throw createError("Policy is fully paid or expired.", 409);
  return {
    policy, installmentId: quote.installmentId.toString(), amountWei: quote.amountWei.toString(),
    amountMinor: premiumWeiToMinor(quote.amountWei), nextDueAt: new Date(Number(quote.dueAt) * 1000),
    opensAt: new Date(Number(quote.opensAt) * 1000), payableNow: quote.payableNow && !quote.reinstatement,
    deploymentScope: await getDeploymentScope(),
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
    deploymentScope: policyDetails.deploymentScope,
    ownerWalletAddress: normalizeWallet(walletAddress),
    policyId: String(policyId),
    status: { $in: ["PENDING_BANK_APPROVAL", "ACTIVE"] },
  });
  if (duplicate) throw createError("This policy already has a pending or active EFT mandate", 409);

  let mandate;
  try {
    mandate = await EftMandate.create({
      mandateId: createId("EFT"),
      deploymentScope: policyDetails.deploymentScope,
      bankId: account.bankId,
      accountReference: account.accountReference,
      policyId: String(policyId),
      ownerWalletAddress: normalizeWallet(walletAddress),
      activeInstructionKey: await createInstructionKey(walletAddress, policyId),
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
      message: `Review the scheduled standing instruction from account •••• ${account.lastFour}.`,
      policyId: String(policyId),
      status: mandate.status,
      link: "/bank/dashboard",
      dedupeKey: `eft-request:${mandate.mandateId}`,
    });
  }
  return mandate;
};

const approveMandate = async ({ bankId, bankWallet, mandateId }) => {
  const deploymentScope = await getDeploymentScope();
  const now = new Date();
  const mandate = await EftMandate.findOneAndUpdate(
    { mandateId, bankId, deploymentScope: await getDeploymentScope(), status: "PENDING_BANK_APPROVAL", validUntil: { $gt: now } },
    [{
      $set: {
        status: "ACTIVE",
        approvedAt: now,
        approvedByWallet: normalizeWallet(bankWallet),
        nextDebitAt: "$validFrom",
        activeInstructionKey: { $concat: [deploymentScope, ":", "$ownerWalletAddress", ":", "$policyId"] },
      },
    }],
    { returnDocument: "after", updatePipeline: true }
  );
  if (!mandate) {
    const expired = await EftMandate.findOneAndUpdate(
      { mandateId, bankId, deploymentScope: await getDeploymentScope(), status: "PENDING_BANK_APPROVAL", validUntil: { $lte: now } },
      { $set: { status: "EXPIRED" }, $unset: { activeInstructionKey: 1 } },
      { returnDocument: "after" }
    );
    if (expired) throw createError("EFT mandate has expired", 409);
    throw createError("Pending mandate was not found", 404);
  }
  await notifyWallet(mandate.ownerWalletAddress, {
    type: "EFT_MANDATE_APPROVED",
    title: `EFT mandate approved for policy #${mandate.policyId}`,
    message: `Scheduled automatic debits begin on ${mandate.nextDebitAt.toISOString()}. EFT debits do not require OTP.`,
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
    { mandateId, bankId, deploymentScope: await getDeploymentScope(), status: "PENDING_BANK_APPROVAL" },
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
    { mandateId, deploymentScope: await getDeploymentScope(), ownerWalletAddress: normalizeWallet(walletAddress), status: { $in: ["PENDING_BANK_APPROVAL", "ACTIVE"] } },
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

const getGatewayReadiness = async ({ walletAddress, policyId }) => {
  const signer = await getBankSigner();
  const registry = getBankIdentityRegistry(signer);
  const [balance, fees, authorized] = await Promise.all([
    signer.provider.getBalance(signer.address), signer.provider.getFeeData(),
    registry.hasRole(await registry.BANK_ROLE(), signer.address),
  ]);
  const quote = policyId ? await loadOwnedPolicy(walletAddress, policyId) : null;
  const required = BigInt(quote?.amountWei || 0) + 300000n * (fees.maxFeePerGas || fees.gasPrice || 0n);
  return { simulatedFiat: true, quoteRateBdtPerEth: "100000", gatewayWallet: signer.address,
    balanceWei: String(balance), balanceEth: ethers.formatEther(balance), requiredWei: String(required),
    ready: authorized && balance >= required,
    message: !authorized ? "Gateway signer is not authorized for this deployment." : balance < required
      ? "The gateway needs test ETH for settlement and gas. The policyholder does not fund the gateway implicitly."
      : "Authorized gateway has estimated settlement and gas funding. Actual transaction validation still applies." };
};

const executeTransferInternal = async (details) => {
  const result = await createSettlement(details, await getBankSigner());
  if (result.status === "PAID") await notifyWallet(details.account.ownerWalletAddress, {
    type: "PREMIUM_PAYMENT_CONFIRMED", title: `Premium installment #${result.installmentId} settled`,
    message: `${(result.amountMinor / 100).toFixed(2)} simulated BDT charged; ${ethers.formatEther(result.amountWei)} test ETH settled.`,
    policyId: String(details.policyId), transactionHash: result.transactionHash, status: "PAID", link: "/user/payments",
    dedupeKey: `bank-payment-paid:${result.transactionId}`,
  });
  return result;
};

const executeTransfer = (details) => {
  const pending = transferQueue.then(() => executeTransferInternal(details));
  transferQueue = pending.catch(() => undefined);
  return pending;
};

const runBankAutomation = async ({ bankId = "", referenceDate = new Date() } = {}) => {
  const now = new Date(referenceDate);
  if (Number.isNaN(now.getTime())) throw createError("Invalid automation reference date");
  const deploymentScope = await getDeploymentScope();
  await reconcilePendingSettlements(await getBankSigner());
  const filter = { deploymentScope, status: "ACTIVE", ...(bankId ? { bankId } : {}) };
  const mandates = await EftMandate.find(filter).sort({ nextDebitAt: 1 });
  const result = { referenceDate: now, reminders: 0, paid: 0, pending: 0, failed: 0, expired: 0, skipped: 0, errors: 0 };

  for (const mandate of mandates) {
    try {
      if (mandate.validUntil < now) {
        mandate.status = "EXPIRED";
        mandate.activeInstructionKey = undefined;
        await mandate.save();
        result.expired += 1;
        continue;
      }
      const shared = await loadOwnedPolicy(mandate.ownerWalletAddress, mandate.policyId);
      if (mandate.nextDebitAt?.getTime() !== shared.nextDueAt.getTime()) {
        mandate.nextDebitAt = shared.nextDueAt; mandate.lastReminderAt = null;
      }
      mandate.amountMinor = shared.amountMinor;
      await mandate.save();
      const daysUntilDue = getReminderLeadDays(mandate.nextDebitAt, now);
      const shortCalendar = Number(shared.policy.premiumInterval) < 86400;
      const secondsUntilDue = (mandate.nextDebitAt.getTime() - now.getTime()) / 1000;
      const reminderWindow = shortCalendar ? secondsUntilDue > 0 && secondsUntilDue <= 480 : isReminderWindow(mandate.nextDebitAt, now);
      if (!mandate.lastReminderAt && reminderWindow) {
        await notifyWallet(mandate.ownerWalletAddress, {
          type: "PREMIUM_DUE_REMINDER",
          title: `Automatic premium debit in ${shortCalendar ? `${Math.ceil(secondsUntilDue / 60)} minutes` : `${daysUntilDue} days`}`,
          message: `${(mandate.amountMinor / 100).toFixed(2)} BDT will be debited for policy #${mandate.policyId}.`,
          policyId: mandate.policyId, status: "SCHEDULED", link: "/user/banking",
          dedupeKey: `eft-reminder:${mandate.mandateId}:${mandate.nextDebitAt.toISOString()}`,
        });
        mandate.lastReminderAt = now;
        await mandate.save();
        result.reminders += 1;
      }
      if (mandate.nextDebitAt > now || mandate.validFrom > now || !shared.payableNow) continue;
      const retryInterval = Math.min(EFT_RETRY_INTERVAL_MS, Number(shared.policy.premiumInterval || 36000) * 100);
      const retryCutoff = new Date(now.getTime() - retryInterval);
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
        account, policyId: claimedMandate.policyId, amountMinor: policyDetails.amountMinor, installmentId: policyDetails.installmentId,
        amountWei: policyDetails.amountWei, type: "EFT", dueAt: claimedMandate.nextDebitAt,
        mandateId: claimedMandate.mandateId,
      });
      claimedMandate.lastTransactionReference = transfer.transactionId;
      if (transfer.status === "PAID") {
        claimedMandate.lastAttemptAt = null;
        claimedMandate.lastDebitedAt = now;
        claimedMandate.lastReminderAt = null;
        const updatedPolicy = await getReadOnlyContract().getPolicy(claimedMandate.policyId);
        claimedMandate.nextDebitAt = new Date(Number(updatedPolicy.nextPremiumDueDate) * 1000);
        result.paid += 1;
      } else if (transfer.status === "PROCESSING") {
        result.pending += 1;
      } else {
        result.failed += 1;
      }
      await claimedMandate.save();
    } catch (error) {
      if (error.statusCode === 409 && /fully paid|expired/i.test(error.message)) {
        await EftMandate.updateOne({ _id: mandate._id, status: "ACTIVE" }, { $set: { status: "EXPIRED" }, $unset: { activeInstructionKey: 1 } });
        result.expired += 1; continue;
      }
      result.errors += 1;
      console.warn(`EFT mandate ${mandate.mandateId} scan failed:`, error.message);
    }
  }
  return result;
};

const requestManualPaymentOtp = async ({ walletAddress, accountReference, policyId }) => {
  const [, quote] = await Promise.all([loadOwnedAccount(walletAddress, accountReference), loadOwnedPolicy(walletAddress, policyId)]);
  if (!quote.payableNow) throw createError(`Next installment opens at ${quote.opensAt.toISOString()} under the issued payment calendar.`, 409);
  const mode = deliveryMode();
  let email = "";
  if (mode === "brevo") {
    const user = await User.findOne({ walletAddress: normalizeWallet(walletAddress) }).select("email +verifiedEmail");
    if (!user?.email || user.email !== user.verifiedEmail) throw createError("Verify your saved profile email before requesting a payment code.", 422);
    email = user.email;
    await reserveDelivery(walletAddress, email);
  }
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
  const challenge = await BankOtpChallenge.create({
    challengeId, ownerWalletAddress: normalizeWallet(walletAddress),
    accountReference, policyId: String(policyId), deploymentScope: quote.deploymentScope, installmentId: quote.installmentId, amountWei: quote.amountWei, amountMinor: quote.amountMinor, otpHash: hashOtp(challengeId, otp), expiresAt, deliveryMode: mode,
  });
  try { return { challengeId, expiresAt, installmentId: quote.installmentId, amountWei: quote.amountWei, amountMinor: quote.amountMinor, simulated: true, ...(await deliverOtp({ email, otp, purpose: "payment" })) }; }
  catch (error) {
    await BankOtpChallenge.updateOne({ _id: challenge._id, status: "PENDING" }, { $set: { status: "FAILED" } });
    throw error;
  }
};

const confirmManualPaymentOtp = async ({ walletAddress, challengeId, otp }) => {
  if (typeof challengeId !== "string" || challengeId.length > 80 || typeof otp !== "string" || !/^\d{6}$/.test(otp)) throw createError("Supply a payment challenge and six-digit code.", 422);
  const challenge = await BankOtpChallenge.findOne({
    challengeId, ownerWalletAddress: normalizeWallet(walletAddress), deploymentScope: await getDeploymentScope(), status: "PENDING",
  }).select("+otpHash");
  if (!challenge) throw createError("Pending OTP challenge was not found", 404);
  if (challenge.deliveryMode !== deliveryMode()) throw createError("OTP delivery mode changed. Request a new payment code.", 409);
  if (challenge.expiresAt <= new Date()) {
    await BankOtpChallenge.updateOne({ _id: challenge._id, status: "PENDING", expiresAt: { $lte: new Date() } }, { $set: { status: "EXPIRED" } });
    throw createError("OTP has expired", 410);
  }
  if (!otpMatches(challenge, otp)) {
    await BankOtpChallenge.findOneAndUpdate({ _id: challenge._id, status: "PENDING", attempts: challenge.attempts },
      { $inc: { attempts: 1 }, $set: { status: challenge.attempts >= 2 ? "LOCKED" : "PENDING" } });
    // A payment OTP is transaction validation, not wallet authentication.
    // Returning 401 would make the client discard an otherwise valid SIWE session.
    throw createError("Incorrect OTP", 422);
  }
  const [account, policyDetails] = await Promise.all([
    loadOwnedAccount(walletAddress, challenge.accountReference),
    loadOwnedPolicy(walletAddress, challenge.policyId),
  ]);
  if (!policyDetails.payableNow || challenge.deploymentScope !== policyDetails.deploymentScope ||
    challenge.installmentId !== policyDetails.installmentId || challenge.amountWei !== policyDetails.amountWei ||
    challenge.amountMinor !== policyDetails.amountMinor) {
    await BankOtpChallenge.updateOne({ _id: challenge._id, status: "PENDING" }, { $set: { status: "EXPIRED" } });
    throw createError("The authorized installment was paid or changed. Request a fresh quote.", 409);
  }
  const consumed = await BankOtpChallenge.findOneAndUpdate(
    { _id: challenge._id, status: "PENDING", attempts: challenge.attempts, expiresAt: { $gt: new Date() } },
    { $set: { status: "USED" } },
    { returnDocument: "after" }
  );
  if (!consumed) throw createError("OTP challenge was already used or expired", 409);
  return executeTransfer({
    account, policyId: challenge.policyId, amountMinor: challenge.amountMinor, installmentId: challenge.installmentId,
    amountWei: challenge.amountWei, type: "MANUAL_OTP", dueAt: policyDetails.nextDueAt,
  });
};

const startBankPaymentScheduler = () => {
  if (scheduler || process.env.NODE_ENV === "test") return;
  scheduler = setInterval(() => {
    runBankAutomation().catch((error) => console.warn("Bank payment scheduler failed:", error.message));
  }, 30 * 1000);
  scheduler.unref();
  reconciliationScheduler = setInterval(() => {
    getBankSigner().then(reconcilePendingSettlements).catch(() => console.warn("Bank settlement reconciliation will retry; unresolved balances remain reserved."));
  }, 5000);
  reconciliationScheduler.unref();
  runBankAutomation().catch((error) => console.warn("Initial bank payment scan failed:", error.message));
};

const stopBankPaymentScheduler = () => {
  if (scheduler) clearInterval(scheduler);
  if (reconciliationScheduler) clearInterval(reconciliationScheduler);
  reconciliationScheduler = null;
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
  getGatewayReadiness,
  isReminderWindow,
  premiumWeiToMinor,
  rejectMandate,
  requestManualPaymentOtp,
  runBankAutomation,
  startBankPaymentScheduler,
  stopBankPaymentScheduler,
};
