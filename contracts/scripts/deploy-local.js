require("dotenv").config();
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function updateEnvValue(filePath, key, value) {
  if (!fs.existsSync(filePath)) {
    console.warn(`Skipped ${filePath}; file does not exist.`);
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  const linePattern = new RegExp(`^${key}=.*$`, "m");
  const nextContent = linePattern.test(content)
    ? content.replace(linePattern, `${key}=${value}`)
    : `${content.replace(/\s*$/, "")}\n${key}=${value}\n`;

  fs.writeFileSync(filePath, nextContent, "utf8");
  console.log(`Updated ${path.relative(process.cwd(), filePath)} (${key})`);
}

function syncLocalContractAddress(contractAddress) {
  const projectRoot = path.resolve(__dirname, "..", "..");
  const targets = [
    { file: path.join(projectRoot, "backend", ".env"), key: "VITE_CONTRACT_ADDRESS" },
    { file: path.join(projectRoot, "frontend", ".env"), key: "VITE_CONTRACT_ADDRESS" },
    { file: path.join(projectRoot, "oracle", ".env"), key: "CONTRACT_ADDRESS" },
    { file: path.join(projectRoot, "oracle", ".env.oracle2"), key: "CONTRACT_ADDRESS" },
  ];

  targets.forEach(({ file, key }) => updateEnvValue(file, key, contractAddress));
}

function syncContractAbi() {
  const projectRoot = path.resolve(__dirname, "..", "..");
  const artifactPath = path.join(
    projectRoot,
    "contracts",
    "artifacts",
    "contracts",
    "InsuranceManager.sol",
    "InsuranceManager.json"
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const abiDocument = JSON.stringify(
    {
      contractName: "InsuranceManager",
      abi: artifact.abi,
    },
    null,
    2
  );

  [
    path.join(projectRoot, "backend", "abi", "InsuranceManager.json"),
    path.join(projectRoot, "frontend", "src", "abi", "InsuranceManager.json"),
    path.join(projectRoot, "oracle", "abi", "InsuranceManager.json"),
  ].forEach((target) => {
    fs.writeFileSync(target, `${abiDocument}\n`, "utf8");
    console.log(`Updated ${path.relative(projectRoot, target)}`);
  });
}

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
  syncContractAbi();
  syncLocalContractAddress(contractAddress);
  console.log("");
  console.log("The local contract address was synchronized to backend, frontend, and oracle environment files.");
  console.log("");
  console.log("CONTRACT_ADDRESS =", contractAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
