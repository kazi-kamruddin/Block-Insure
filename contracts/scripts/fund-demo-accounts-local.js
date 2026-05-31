const { ethers } = require("hardhat");

const accountsToFund = [
  {
    name: "adminAccount",
    address: "0xd388BB1572CDb7F7dB2bb485a1051749F9B1ff1E",
  },
  {
    name: "userAccount",
    address: "0x6575cBC8B95aBc6aB6628e7AeC176aF5769580F9",
  },
  {
    name: "userTwoAccount",
    address: "0x6C3fBFC259346E7CEDA4d0f3E792d4A81Ee25D05",
  },
  {
    name: "auditorAccount",
    address: "0x62C6343B7a3AAA23cED5BE620B4e0cFA3FEd3b7B",
  },
  {
    name: "oracleAccount",
    address: "0xf9461b649ef230a724153352D74211555C6bF168",
  },
];

async function main() {
  const [richAccount] = await ethers.getSigners();

  console.log("Funding from:", richAccount.address);

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