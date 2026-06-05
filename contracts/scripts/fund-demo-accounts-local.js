const path = require("path");
const { ethers } = require("hardhat");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
require("dotenv").config({
  path: path.join(__dirname, "..", "..", "backend", ".env"),
  override: false,
});

function getAddressFromPrivateKey(privateKey) {
  if (!privateKey) {
    return "";
  }

  try {
    return new ethers.Wallet(privateKey).address;
  } catch {
    return "";
  }
}

function readAddressList(...keys) {
  return keys.flatMap((key) => {
    const value = process.env[key];

    if (!value) {
      return [];
    }

    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  });
}

function addAccount(accounts, seen, name, address) {
  if (!address) {
    return;
  }

  const normalizedAddress = ethers.getAddress(address);
  const key = normalizedAddress.toLowerCase();

  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  accounts.push({
    name,
    address: normalizedAddress,
  });
}

function getAccountsToFund() {
  const accounts = [];
  const seen = new Set();

  addAccount(accounts, seen, "adminAccount", getAddressFromPrivateKey(process.env.ADMIN_PRIVATE_KEY));
  addAccount(accounts, seen, "oracleAccount", getAddressFromPrivateKey(process.env.ORACLE_PRIVATE_KEY));
  addAccount(accounts, seen, "oracleTwoAccount", getAddressFromPrivateKey(process.env.ORACLE_PRIVATE_KEY_2));
  addAccount(
    accounts,
    seen,
    "claimOfficerAccount",
    process.env.CLAIM_OFFICER_WALLET_ADDRESS
  );

  readAddressList(
    "AUDITOR_WALLET_ADDRESS",
    "AUDITOR_2_WALLET_ADDRESS",
    "AUDITOR_3_WALLET_ADDRESS",
    "AUDITOR_4_WALLET_ADDRESS",
    "AUDITOR_5_WALLET_ADDRESS",
    "AUDITOR_WALLET_ADDRESSES"
  ).forEach((address, index) => {
    addAccount(accounts, seen, `auditor${index + 1}Account`, address);
  });

  addAccount(
    accounts,
    seen,
    "defaultLocalUserAccount",
    "0x6575cBC8B95aBc6aB6628e7AeC176aF5769580F9"
  );

  return accounts;
}

async function main() {
  const [richAccount] = await ethers.getSigners();
  const accountsToFund = getAccountsToFund();

  console.log("Funding from:", richAccount.address);
  console.log(`Accounts to fund: ${accountsToFund.length}`);

  for (const account of accountsToFund) {
    const tx = await richAccount.sendTransaction({
      to: account.address,
      value: ethers.parseEther("100"),
    });

    await tx.wait();

    const balance = await ethers.provider.getBalance(account.address);

    console.log(
      `${account.name} ${account.address} -> ${ethers.formatEther(balance)} ETH`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
