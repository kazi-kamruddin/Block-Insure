require("dotenv").config();
const hre = require("hardhat");

async function main() {
  if (!process.env.ADMIN_PRIVATE_KEY) {
    throw new Error("Missing ADMIN_PRIVATE_KEY in contracts/.env");
  }

  const provider = hre.ethers.provider;
  const adminWallet = new hre.ethers.Wallet(
    process.env.ADMIN_PRIVATE_KEY,
    provider
  );

  const adminBalance = await provider.getBalance(adminWallet.address);

  console.log("Deploying InsuranceManager with admin wallet:");
  console.log("Admin address:", adminWallet.address);
  console.log("Admin local balance:", hre.ethers.formatEther(adminBalance), "ETH");

  if (adminBalance === 0n) {
    throw new Error(
      "Admin wallet has 0 local ETH. Fund adminAccount on localhost before deploying."
    );
  }

  const InsuranceManager = await hre.ethers.getContractFactory(
    "InsuranceManager",
    adminWallet
  );

  const insuranceManager = await InsuranceManager.deploy();

  await insuranceManager.waitForDeployment();

  const contractAddress = await insuranceManager.getAddress();

  console.log("InsuranceManager deployed to:", contractAddress);

  const premiumAmount = hre.ethers.parseEther("0.01");
  const coverageAmount = hre.ethers.parseEther("1");

  const tx = await insuranceManager.createPolicyPackage(
    "Health Basic",
    "HEALTH",
    premiumAmount,
    coverageAmount,
    365,
    "HOSPITAL_BILL"
  );

  await tx.wait();

  console.log("Health Basic policy package created");
  console.log("");
  console.log("Copy this contract address into:");
  console.log("- backEnd/.env      VITE_CONTRACT_ADDRESS");
  console.log("- frontEnd/.env     VITE_CONTRACT_ADDRESS");
  console.log("- oracle/.env       CONTRACT_ADDRESS");
  console.log("");
  console.log("CONTRACT_ADDRESS =", contractAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
