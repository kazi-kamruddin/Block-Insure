const path = require("path");
const projectRoot = path.resolve(__dirname, "..", "..");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
require("dotenv").config({ path: path.join(projectRoot, "backEnd", ".env") });
const hre = require("hardhat");
const fs = require("fs");

function requireEnv(key) {
  const value = String(process.env[key] || "").trim();
  if (!value) throw new Error(`Missing ${key} in contracts/.env`);
  return value;
}

function updateEnvValue(filePath, key, value) {
  if (!fs.existsSync(filePath)) {
    console.warn(`Skipped ${filePath}; file does not exist.`);
    return;
  }
  const content = fs.readFileSync(filePath, "utf8");
  const pattern = new RegExp(`^${key}=.*$`, "m");
  const next = pattern.test(content)
    ? content.replace(pattern, `${key}=${value}`)
    : `${content.replace(/\s*$/, "")}\n${key}=${value}\n`;
  fs.writeFileSync(filePath, next, "utf8");
}

async function main() {
  const managerAddress = requireEnv("VITE_CONTRACT_ADDRESS");
  const adminPrivateKey = requireEnv("ADMIN_PRIVATE_KEY");
  const provider = hre.ethers.provider;
  const code = await provider.getCode(managerAddress);
  if (code === "0x") {
    throw new Error(`InsuranceManager is not deployed at ${managerAddress}`);
  }

  const adminWallet = new hre.ethers.Wallet(adminPrivateKey, provider);
  const Benefits = await hre.ethers.getContractFactory(
    "PolicyBenefitsManager",
    adminWallet
  );
  const benefits = await Benefits.deploy(managerAddress, adminWallet.address);
  await benefits.waitForDeployment();
  const address = await benefits.getAddress();
  const deploymentReceipt = await benefits.deploymentTransaction().wait();
  const schedule = {
    packageId: 1,
    version: 1,
    deathBenefitEnabled: true,
    surrenderEnabled: true,
    maturityEnabled: false,
    deathBenefitBps: 10000,
    surrenderValueBps: 5000,
    maturityBonusBps: 0,
    minimumSurrenderInstallments: 6,
  };
  await (
    await benefits.publishBenefitTerms(
      1,
      schedule.deathBenefitEnabled,
      schedule.surrenderEnabled,
      schedule.maturityEnabled,
      schedule.deathBenefitBps,
      schedule.surrenderValueBps,
      schedule.maturityBonusBps,
      schedule.minimumSurrenderInstallments,
      schedule.version,
      hre.ethers.keccak256(hre.ethers.toUtf8Bytes(JSON.stringify(schedule)))
    )
  ).wait();
  await (
    await adminWallet.sendTransaction({
      to: address,
      value: hre.ethers.parseEther("2"),
    })
  ).wait();

  const targets = [
    [path.join(projectRoot, "backEnd", ".env"), "POLICY_BENEFITS_ADDRESS"],
    [path.join(projectRoot, "frontEnd", ".env"), "VITE_POLICY_BENEFITS_ADDRESS"],
  ];
  const blockTargets = [
    [
      path.join(projectRoot, "backEnd", ".env"),
      "POLICY_BENEFITS_DEPLOYMENT_BLOCK",
    ],
    [
      path.join(projectRoot, "frontEnd", ".env"),
      "VITE_POLICY_BENEFITS_DEPLOYMENT_BLOCK",
    ],
  ];
  targets.forEach(([file, key]) => updateEnvValue(file, key, address));
  blockTargets.forEach(([file, key]) =>
    updateEnvValue(file, key, deploymentReceipt.blockNumber)
  );

  console.log("PolicyBenefitsManager deployed without resetting existing data:", address);
  console.log("Restart backend and frontend processes to load the synchronized address.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
