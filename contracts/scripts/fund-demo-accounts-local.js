const path = require("path");
const { ethers } = require("hardhat");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
require("dotenv").config({
  path: path.join(__dirname, "..", "..", "backEnd", ".env"),
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

  // Local role addresses may be copied from an environment file with mixed
  // casing that is not a valid EIP-55 checksum. They are still valid 20-byte
  // addresses, so canonicalize the hex before asking ethers to checksum it.
  const normalizedAddress = ethers.getAddress(String(address).trim().toLowerCase());
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
  addAccount(accounts, seen, "auditorThreeAccount", process.env.AUDITOR_WALLET_ADDRESS_3 || "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955");
  addAccount(accounts, seen, "auditorFourAccount", process.env.AUDITOR_WALLET_ADDRESS_4 || "0x23618e81e3F5Cdf7F54C3D65F7fBFB5d82F842fB");

  addAccount(
    accounts,
    seen,
    "auditorAccount",
    process.env.AUDITOR_WALLET_ADDRESS
  );
  addAccount(
    accounts,
    seen,
    "auditorTwoAccount",
    process.env.AUDITOR_WALLET_ADDRESS_2 ||
      getAddressFromPrivateKey(process.env.DEMO_AUDITOR_PRIVATE_KEY_2)
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
