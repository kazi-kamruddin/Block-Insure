const hre = require("hardhat");

async function main() {
  const InsuranceManager = await hre.ethers.getContractFactory("InsuranceManager");
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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});