const Bank = require("../models/Bank");
const BankAccount = require("../models/BankAccount");
const BankTransaction = require("../models/BankTransaction");
const EftMandate = require("../models/EftMandate");
const { findBankByWallet, formatBank } = require("../services/bankDirectoryService");
const {
  approveMandate, cancelMandate, confirmManualPaymentOtp, createMandate,
  rejectMandate, requestManualPaymentOtp, runBankAutomation,
} = require("../services/bankPaymentService");

const formatMoney = (minor) => (Number(minor || 0) / 100).toFixed(2);
const normalizeWallet = (value) => String(value || "").toLowerCase();
const withAuthenticatedWallet = (body, walletAddress) => ({ ...body, walletAddress });

const getBankIdentity = async (user) => {
  const bank = await findBankByWallet(user.walletAddress);
  if (!bank || bank.operatingStatus !== "ACTIVE") {
    const error = new Error("No active bank identity is assigned to this wallet");
    error.statusCode = 403;
    throw error;
  }
  return bank;
};

const formatAccount = (account) => ({
  accountReference: account.accountReference,
  accountHolderName: account.accountHolderName,
  ownerWalletAddress: account.ownerWalletAddress,
  maskedAccount: `•••• ${account.lastFour}`,
  currency: account.currency,
  balanceMinor: account.balanceMinor,
  balance: formatMoney(account.balanceMinor),
  status: account.status,
  updatedAt: account.updatedAt,
});

const formatMandate = (mandate) => ({
  mandateId: mandate.mandateId,
  bankId: mandate.bankId,
  accountReference: mandate.accountReference,
  policyId: mandate.policyId,
  ownerWalletAddress: mandate.ownerWalletAddress,
  destinationReference: mandate.destinationReference,
  amountMinor: mandate.amountMinor,
  amount: formatMoney(mandate.amountMinor),
  currency: mandate.currency,
  frequency: mandate.frequency,
  validFrom: mandate.validFrom,
  validUntil: mandate.validUntil,
  nextDebitAt: mandate.nextDebitAt,
  approvedAt: mandate.approvedAt,
  lastDebitedAt: mandate.lastDebitedAt,
  debitCount: mandate.debitCount,
  rejectionReason: mandate.rejectionReason,
  status: mandate.status,
});

const formatTransaction = (transaction) => ({
  transactionId: transaction.transactionId,
  bankId: transaction.bankId,
  accountReference: transaction.accountReference,
  ownerWalletAddress: transaction.ownerWalletAddress,
  policyId: transaction.policyId,
  mandateId: transaction.mandateId,
  type: transaction.type,
  status: transaction.status,
  amountMinor: transaction.amountMinor,
  amount: formatMoney(transaction.amountMinor),
  amountWei: transaction.amountWei,
  currency: transaction.currency,
  dueAt: transaction.dueAt,
  completedAt: transaction.completedAt,
  transactionHash: transaction.transactionHash,
  failureReason: transaction.failureReason,
});

const getNetworkBanks = async (_req, res, next) => {
  try {
    const banks = await Bank.find({ operatingStatus: "ACTIVE" }).sort({ bankId: 1 }).lean();
    res.status(200).json({ success: true, count: banks.length, banks: banks.map(formatBank) });
  } catch (error) { next(error); }
};

const getMyBankProfile = async (req, res, next) => {
  try {
    const bank = await getBankIdentity(req.user);
    const accountFilter = { bankId: bank.bankId };
    const [accounts, activeAccounts, mandates, pendingMandates, transactions] = await Promise.all([
      BankAccount.countDocuments(accountFilter),
      BankAccount.countDocuments({ ...accountFilter, status: "ACTIVE" }),
      EftMandate.countDocuments({ bankId: bank.bankId }),
      EftMandate.countDocuments({ bankId: bank.bankId, status: "PENDING_BANK_APPROVAL" }),
      BankTransaction.countDocuments({ bankId: bank.bankId }),
    ]);
    const balance = await BankAccount.aggregate([
      { $match: accountFilter },
      { $group: { _id: null, total: { $sum: "$balanceMinor" } } },
    ]);
    const totalBalanceMinor = balance[0]?.total || 0;
    res.status(200).json({
      success: true,
      bank: formatBank(bank),
      summary: { accounts, activeAccounts, mandates, pendingMandates, transactions, totalBalanceMinor, totalBalance: formatMoney(totalBalanceMinor) },
      capabilities: {
        viewOwnedAccounts: true, reviewMandates: true, scheduledDebits: true, manualPaymentOtp: true,
        note: "Quarterly EFT approval, reminders, automatic debits, confirmations, and OTP-protected manual transfers are active.",
      },
    });
  } catch (error) { next(error); }
};

const getMyBankAccounts = async (req, res, next) => {
  try {
    const bank = await getBankIdentity(req.user);
    const accounts = await BankAccount.find({ bankId: bank.bankId }).sort({ accountReference: 1 }).lean();
    res.status(200).json({ success: true, bank: formatBank(bank), count: accounts.length, accounts: accounts.map(formatAccount) });
  } catch (error) { next(error); }
};

const getMyBankMandates = async (req, res, next) => {
  try {
    const bank = await getBankIdentity(req.user);
    const mandates = await EftMandate.find({ bankId: bank.bankId }).sort({ createdAt: -1 }).lean();
    res.status(200).json({ success: true, count: mandates.length, mandates: mandates.map(formatMandate), executionEnabled: true });
  } catch (error) { next(error); }
};

const getMyBankTransactions = async (req, res, next) => {
  try {
    const bank = await getBankIdentity(req.user);
    const transactions = await BankTransaction.find({ bankId: bank.bankId }).sort({ createdAt: -1 }).limit(100).lean();
    res.status(200).json({ success: true, count: transactions.length, transactions: transactions.map(formatTransaction) });
  } catch (error) { next(error); }
};

const approveMyBankMandate = async (req, res, next) => {
  try {
    const bank = await getBankIdentity(req.user);
    const mandate = await approveMandate({ bankId: bank.bankId, bankWallet: req.user.walletAddress, mandateId: req.params.mandateId });
    res.status(200).json({ success: true, message: "EFT mandate approved", mandate: formatMandate(mandate) });
  } catch (error) { next(error); }
};

const rejectMyBankMandate = async (req, res, next) => {
  try {
    const bank = await getBankIdentity(req.user);
    const mandate = await rejectMandate({ bankId: bank.bankId, mandateId: req.params.mandateId, reason: req.body.reason });
    res.status(200).json({ success: true, message: "EFT mandate rejected", mandate: formatMandate(mandate) });
  } catch (error) { next(error); }
};

const runMyBankAutomation = async (req, res, next) => {
  try {
    const bank = await getBankIdentity(req.user);
    const result = await runBankAutomation({ bankId: bank.bankId, referenceDate: req.body.referenceDate || new Date() });
    res.status(200).json({ success: true, message: "Bank automation scan completed", result });
  } catch (error) { next(error); }
};

const getMyUserAccounts = async (req, res, next) => {
  try {
    const accounts = await BankAccount.find({ ownerWalletAddress: normalizeWallet(req.user.walletAddress) }).sort({ accountReference: 1 }).lean();
    res.status(200).json({ success: true, count: accounts.length, accounts: accounts.map(formatAccount) });
  } catch (error) { next(error); }
};

const getMyUserMandates = async (req, res, next) => {
  try {
    const mandates = await EftMandate.find({ ownerWalletAddress: normalizeWallet(req.user.walletAddress) }).sort({ createdAt: -1 }).lean();
    res.status(200).json({ success: true, count: mandates.length, mandates: mandates.map(formatMandate) });
  } catch (error) { next(error); }
};

const getMyUserTransactions = async (req, res, next) => {
  try {
    const transactions = await BankTransaction.find({ ownerWalletAddress: normalizeWallet(req.user.walletAddress) }).sort({ createdAt: -1 }).limit(100).lean();
    res.status(200).json({ success: true, count: transactions.length, transactions: transactions.map(formatTransaction) });
  } catch (error) { next(error); }
};

const createMyMandate = async (req, res, next) => {
  try {
    const mandate = await createMandate(withAuthenticatedWallet(req.body, req.user.walletAddress));
    res.status(201).json({ success: true, message: "EFT mandate sent to the bank for approval", mandate: formatMandate(mandate) });
  } catch (error) { next(error); }
};

const cancelMyMandate = async (req, res, next) => {
  try {
    const mandate = await cancelMandate({ walletAddress: req.user.walletAddress, mandateId: req.params.mandateId });
    res.status(200).json({ success: true, message: "EFT mandate cancelled", mandate: formatMandate(mandate) });
  } catch (error) { next(error); }
};

const requestMyManualOtp = async (req, res, next) => {
  try {
    const challenge = await requestManualPaymentOtp(withAuthenticatedWallet(req.body, req.user.walletAddress));
    res.status(201).json({ success: true, ...challenge });
  } catch (error) { next(error); }
};

const confirmMyManualOtp = async (req, res, next) => {
  try {
    const transaction = await confirmManualPaymentOtp(withAuthenticatedWallet(req.body, req.user.walletAddress));
    res.status(transaction.status === "PAID" ? 200 : 409).json({
      success: transaction.status === "PAID",
      message: transaction.status === "PAID" ? "Manual bank payment confirmed" : transaction.failureReason,
      transaction: formatTransaction(transaction),
    });
  } catch (error) { next(error); }
};

module.exports = {
  approveMyBankMandate, cancelMyMandate, confirmMyManualOtp, createMyMandate,
  getMyBankAccounts, getMyBankMandates, getMyBankProfile, getMyBankTransactions,
  getMyUserAccounts, getMyUserMandates, getMyUserTransactions, getNetworkBanks,
  rejectMyBankMandate, requestMyManualOtp, runMyBankAutomation,
  withAuthenticatedWallet,
};
