const Bank = require("../models/Bank");
const BankAccount = require("../models/BankAccount");
const User = require("../models/User");
const { BANK_NETWORK, DEMO_BANK_ACCOUNTS } = require("../config/bankNetwork");

const formatBank = (bank) => ({
  bankId: bank.bankId,
  name: bank.name,
  walletAddress: bank.walletAddress,
  routingCode: bank.routingCode,
  currency: bank.currency,
  operatingStatus: bank.operatingStatus,
  joinedAt: bank.joinedAt,
});

const seedBankDirectory = async () => {
  const bank = BANK_NETWORK[0];
  await Bank.findOneAndUpdate(
    { bankId: bank.bankId },
    {
      $set: { ...bank, operatingStatus: "ACTIVE" },
      $setOnInsert: { joinedAt: new Date() },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );
  await User.findOneAndUpdate(
    { walletAddress: bank.walletAddress },
    { walletAddress: bank.walletAddress, name: bank.name, role: "BANK" },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );

  for (const account of DEMO_BANK_ACCOUNTS) {
    await BankAccount.findOneAndUpdate(
      { accountReference: account.accountReference },
      {
        $set: {
          ...account,
          bankId: bank.bankId,
          currency: bank.currency,
          status: "ACTIVE",
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );
  }

  return Bank.find({}).sort({ bankId: 1 }).lean();
};

const findBankByWallet = (walletAddress) =>
  Bank.findOne({ walletAddress: String(walletAddress || "").toLowerCase() });

module.exports = { findBankByWallet, formatBank, seedBankDirectory };
