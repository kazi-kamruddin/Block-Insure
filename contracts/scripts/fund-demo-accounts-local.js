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

  addAccount(
    accounts,
    seen,
    "auditorAccount",
    process.env.AUDITOR_WALLET_ADDRESS
  );

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
