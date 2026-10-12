const configuredBankWallet = String(process.env.BANK_WALLET_ADDRESS || "").trim();
const configuredAccountOwners = String(
  process.env.DEMO_BANK_ACCOUNT_OWNER_ADDRESSES || ""
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const BANK_NETWORK = Object.freeze([
  {
    bankId: "BANK-001",
    name: "Bangladesh Demo Commercial Bank",
    routingCode: "BD-DEMO-001",
    walletAddress:
      configuredBankWallet || "0xcd3b766ccdd6ae721141f452c550ca635964ce71",
    currency: "BDT",
  },
]);

const defaultDemoBankAccounts = [
  {
    accountReference: "DEMO-5000",
    ownerWalletAddress: "0x0bd6e65d2c8a48ff1136d061caf39bce669ed0fd",
    accountHolderName: "Demo Policyholder A",
    lastFour: "5000",
    balanceMinor: 500000,
  },
  {
    accountReference: "DEMO-7000",
    ownerWalletAddress: "0x6575cbc8b95abc6ab6628e7aec176af5769580f9",
    accountHolderName: "Demo Policyholder B",
    lastFour: "7000",
    balanceMinor: 700000,
  },
  {
    accountReference: "DEMO-10000",
    ownerWalletAddress: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
    accountHolderName: "Demo Policyholder C",
    lastFour: "0000",
    balanceMinor: 1000000,
  },
];

if (configuredAccountOwners.length && configuredAccountOwners.length !== 3) {
  throw new Error("DEMO_BANK_ACCOUNT_OWNER_ADDRESSES must contain exactly 3 addresses");
}

const DEMO_BANK_ACCOUNTS = Object.freeze(
  defaultDemoBankAccounts.map((account, index) =>
    Object.freeze({
      ...account,
      ownerWalletAddress:
        configuredAccountOwners[index] || account.ownerWalletAddress,
    })
  )
);

module.exports = { BANK_NETWORK, DEMO_BANK_ACCOUNTS };
