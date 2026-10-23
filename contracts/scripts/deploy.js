require("dotenv").config();
const hre = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");
const { verifyModelArtifact } = require("../../backEnd/services/modelArtifactService");

const networkName = hre.network.name;
const isLocalNetwork = networkName === "localhost" || networkName === "hardhat";

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

function syncLocalContractDeployment(
  contractAddress,
  deploymentBlock,
  adjudicatorAddress,
  benefitsAddress,
  benefitsDeploymentBlock,
  economicsAddress,
  evidenceRegistryAddress,
  deploymentRegistryAddress,
  hospitalVerificationRegistryAddress,
  bankIdentityRegistryAddress
) {
  const projectRoot = path.resolve(__dirname, "..", "..");
  const targets = [
    { file: path.join(projectRoot, "backEnd", ".env"), key: "VITE_CONTRACT_ADDRESS" },
    { file: path.join(projectRoot, "frontEnd", ".env"), key: "VITE_CONTRACT_ADDRESS" },
    { file: path.join(projectRoot, "oracle", ".env"), key: "CONTRACT_ADDRESS" },
    { file: path.join(projectRoot, "oracle", ".env.oracle2"), key: "CONTRACT_ADDRESS" },
  ];

  targets.forEach(({ file, key }) => updateEnvValue(file, key, contractAddress));

  [
    { file: path.join(projectRoot, "backEnd", ".env"), key: "CLAIM_ADJUDICATOR_ADDRESS" },
    { file: path.join(projectRoot, "frontEnd", ".env"), key: "VITE_CLAIM_ADJUDICATOR_ADDRESS" },
  ].forEach(({ file, key }) => updateEnvValue(file, key, adjudicatorAddress));

  [
    { file: path.join(projectRoot, "backEnd", ".env"), key: "POLICY_ECONOMICS_ADDRESS" },
    { file: path.join(projectRoot, "frontEnd", ".env"), key: "VITE_POLICY_ECONOMICS_ADDRESS" },
  ].forEach(({ file, key }) => updateEnvValue(file, key, economicsAddress));

  [
    { file: path.join(projectRoot, "backEnd", ".env"), key: "EVIDENCE_REGISTRY_ADDRESS" },
    { file: path.join(projectRoot, "frontEnd", ".env"), key: "VITE_EVIDENCE_REGISTRY_ADDRESS" },
  ].forEach(({ file, key }) => updateEnvValue(file, key, evidenceRegistryAddress));

  [
    { file: path.join(projectRoot, "backEnd", ".env"), key: "HOSPITAL_VERIFICATION_REGISTRY_ADDRESS" },
    { file: path.join(projectRoot, "frontEnd", ".env"), key: "VITE_HOSPITAL_VERIFICATION_REGISTRY_ADDRESS" },
  ].forEach(({ file, key }) => updateEnvValue(file, key, hospitalVerificationRegistryAddress));

  [
    { file: path.join(projectRoot, "backEnd", ".env"), key: "BANK_IDENTITY_REGISTRY_ADDRESS" },
    { file: path.join(projectRoot, "frontEnd", ".env"), key: "VITE_BANK_IDENTITY_REGISTRY_ADDRESS" },
  ].forEach(({ file, key }) => updateEnvValue(file, key, bankIdentityRegistryAddress));

  [
    { file: path.join(projectRoot, "backEnd", ".env"), key: "PROTOCOL_DEPLOYMENT_REGISTRY_ADDRESS" },
    { file: path.join(projectRoot, "frontEnd", ".env"), key: "VITE_PROTOCOL_DEPLOYMENT_REGISTRY_ADDRESS" },
  ].forEach(({ file, key }) => updateEnvValue(file, key, deploymentRegistryAddress));

  [
    { file: path.join(projectRoot, "backEnd", ".env"), key: "POLICY_BENEFITS_ADDRESS" },
    { file: path.join(projectRoot, "frontEnd", ".env"), key: "VITE_POLICY_BENEFITS_ADDRESS" },
  ].forEach(({ file, key }) => updateEnvValue(file, key, benefitsAddress));

  [
    {
      file: path.join(projectRoot, "backEnd", ".env"),
      key: "CONTRACT_DEPLOYMENT_BLOCK",
    },
    {
      file: path.join(projectRoot, "frontEnd", ".env"),
      key: "VITE_CONTRACT_DEPLOYMENT_BLOCK",
    },
    {
      file: path.join(projectRoot, "oracle", ".env"),
      key: "ORACLE_START_BLOCK",
    },
    {
      file: path.join(projectRoot, "oracle", ".env.oracle2"),
      key: "ORACLE_START_BLOCK",
    },
  ].forEach(({ file, key }) => updateEnvValue(file, key, deploymentBlock));

  [
    {
      file: path.join(projectRoot, "backEnd", ".env"),
      key: "POLICY_BENEFITS_DEPLOYMENT_BLOCK",
    },
    {
      file: path.join(projectRoot, "frontEnd", ".env"),
      key: "VITE_POLICY_BENEFITS_DEPLOYMENT_BLOCK",
    },
  ].forEach(({ file, key }) => updateEnvValue(file, key, benefitsDeploymentBlock));
}

function syncContractAbi() {
  const projectRoot = path.resolve(__dirname, "..", "..");
  [
    "InsuranceManager",
    "OracleCoordinator",
    "ClaimAdjudicator",
    "PolicyEconomics",
    "PolicyBenefitsManager",
    "EvidenceRegistry",
    "ProtocolDeploymentRegistry",
    "HospitalVerificationRegistry",
    "BankIdentityRegistry",
  ].forEach((contractName) => {
    const artifactPath = path.join(
      projectRoot,
      "contracts",
      "artifacts",
      "contracts",
      `${contractName}.sol`,
      `${contractName}.json`
    );
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    const abiDocument = JSON.stringify({ contractName, abi: artifact.abi }, null, 2);

    [
      path.join(projectRoot, "backEnd", "abi", `${contractName}.json`),
      path.join(projectRoot, "frontEnd", "src", "abi", `${contractName}.json`),
      path.join(projectRoot, "oracle", "abi", `${contractName}.json`),
    ].forEach((target) => {
      fs.writeFileSync(target, `${abiDocument}\n`, "utf8");
      console.log(`Updated ${path.relative(projectRoot, target)}`);
    });
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
  console.log("Deployment network:", networkName);
  console.log("Admin balance:", hre.ethers.formatEther(adminBalance), "ETH");

  if (adminBalance === 0n) {
    throw new Error(
      `Admin wallet has 0 ETH on ${networkName}. Fund it before deploying.`
    );
  }

  const InsuranceManager = await hre.ethers.getContractFactory(
    "InsuranceManager",
    adminWallet
  );

  const insuranceManager = await InsuranceManager.deploy();

  await insuranceManager.waitForDeployment();

  const contractAddress = await insuranceManager.getAddress();
  const deploymentReceipt = await insuranceManager.deploymentTransaction().wait();
  const deploymentBlock = deploymentReceipt.blockNumber;

  console.log("InsuranceManager deployed to:", contractAddress);
  console.log("InsuranceManager deployment block:", deploymentBlock);
  console.log("OracleCoordinator deployed to:", await insuranceManager.oracleCoordinator());
  const HospitalVerificationRegistry = await hre.ethers.getContractFactory(
    "HospitalVerificationRegistry",
    adminWallet
  );
  const hospitalVerificationRegistry = await HospitalVerificationRegistry.deploy(
    contractAddress,
    adminWallet.address
  );
  await hospitalVerificationRegistry.waitForDeployment();
  const hospitalVerificationRegistryAddress =
    await hospitalVerificationRegistry.getAddress();
  const oracleCoordinator = await hre.ethers.getContractAt(
    "OracleCoordinator",
    await insuranceManager.oracleCoordinator(),
    adminWallet
  );
  await (
    await oracleCoordinator.configureHospitalVerificationRegistry(
      hospitalVerificationRegistryAddress
    )
  ).wait();
  console.log(
    "HospitalVerificationRegistry deployed to:",
    hospitalVerificationRegistryAddress
  );
  const BankIdentityRegistry = await hre.ethers.getContractFactory(
    "BankIdentityRegistry",
    adminWallet
  );
  const bankIdentityRegistry = await BankIdentityRegistry.deploy(
    contractAddress,
    adminWallet.address
  );
  await bankIdentityRegistry.waitForDeployment();
  const bankIdentityRegistryAddress = await bankIdentityRegistry.getAddress();
  await (
    await insuranceManager.configureBankPaymentRegistry(bankIdentityRegistryAddress)
  ).wait();
  console.log("BankIdentityRegistry deployed to:", bankIdentityRegistryAddress);
  const modelArtifactPath = path.resolve(__dirname, "..", "..", "backEnd", "model-params.json");
  const modelArtifact = JSON.parse(fs.readFileSync(modelArtifactPath, "utf8"));
  const modelVerification = verifyModelArtifact(modelArtifact);
  if (!modelVerification.valid) {
    throw new Error(`Frozen model artifact is invalid: ${modelVerification.errors.join("; ")}`);
  }
  await (await insuranceManager.updateOracleModelVersion(modelArtifact.modelIdentityHash)).wait();
  console.log("Frozen fraud-model identity:", modelArtifact.modelIdentityHash);

  const ClaimAdjudicator = await hre.ethers.getContractFactory(
    "ClaimAdjudicator",
    adminWallet
  );
  const claimAdjudicator = await ClaimAdjudicator.deploy(contractAddress);
  await claimAdjudicator.waitForDeployment();
  const adjudicatorAddress = await claimAdjudicator.getAddress();
  await (await insuranceManager.configureClaimAdjudicator(adjudicatorAddress)).wait();
  console.log("ClaimAdjudicator deployed to:", adjudicatorAddress);
  const economicsAddress = await insuranceManager.policyEconomics();
  console.log("PolicyEconomics deployed to:", economicsAddress);

  const EvidenceRegistry = await hre.ethers.getContractFactory(
    "EvidenceRegistry",
    adminWallet
  );
  const evidenceRegistry = await EvidenceRegistry.deploy(contractAddress);
  await evidenceRegistry.waitForDeployment();
  const evidenceRegistryAddress = await evidenceRegistry.getAddress();
  console.log("EvidenceRegistry deployed to:", evidenceRegistryAddress);

  const premiumAmount = hre.ethers.parseEther(
    process.env.INITIAL_POLICY_PREMIUM_ETH || "0.01"
  );
  const coverageAmount = hre.ethers.parseEther(
    process.env.INITIAL_POLICY_COVERAGE_ETH || "1"
  );

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

  const PolicyBenefitsManager = await hre.ethers.getContractFactory(
    "PolicyBenefitsManager",
    adminWallet
  );
  const benefitsManager = await PolicyBenefitsManager.deploy(
    contractAddress
  );
  await benefitsManager.waitForDeployment();
  const benefitsAddress = await benefitsManager.getAddress();
  const economics = await hre.ethers.getContractAt("PolicyEconomics", economicsAddress, adminWallet);
  await (await economics.configureBenefitsManager(benefitsAddress)).wait();
  const benefitsReceipt = await benefitsManager.deploymentTransaction().wait();
  const benefitsDeploymentBlock = benefitsReceipt.blockNumber;
  const defaultTermsDocument = JSON.stringify({
    packageId: 1,
    version: 1,
    deathBenefitEnabled: true,
    surrenderEnabled: true,
    maturityEnabled: false,
    deathBenefitBps: 10000,
    surrenderValueBps: 5000,
    maturityBonusBps: 0,
    minimumSurrenderInstallments: 6,
  });
  await (
    await benefitsManager.publishBenefitTerms(
      1,
      true,
      true,
      false,
      10000,
      5000,
      0,
      6,
      1,
      hre.ethers.keccak256(hre.ethers.toUtf8Bytes(defaultTermsDocument))
    )
  ).wait();
  const benefitsReserve = hre.ethers.parseEther(
    process.env.INITIAL_BENEFITS_RESERVE_ETH || (isLocalNetwork ? "2" : "0.02")
  );
  if (benefitsReserve > 0n) {
    await (
      await adminWallet.sendTransaction({
        to: benefitsAddress,
        value: benefitsReserve,
      })
    ).wait();
  }

  console.log("PolicyBenefitsManager deployed to:", benefitsAddress);
  const migrationManifest = fs.readFileSync(
    path.resolve(__dirname, "..", "..", "docs", "protocol-v2-migration.json"),
    "utf8"
  );
  const ProtocolDeploymentRegistry = await hre.ethers.getContractFactory(
    "ProtocolDeploymentRegistry",
    adminWallet
  );
  const deploymentRegistry = await ProtocolDeploymentRegistry.deploy(
    hre.ethers.id("BLOCK_INSURE_V1"),
    hre.ethers.keccak256(hre.ethers.toUtf8Bytes(migrationManifest))
  );
  await deploymentRegistry.waitForDeployment();
  const deploymentRegistryAddress = await deploymentRegistry.getAddress();
  for (const [name, address, interfaceVersion] of [
    ["InsuranceManager", contractAddress, "IInsuranceManager/1"],
    ["OracleCoordinator", await insuranceManager.oracleCoordinator(), "IOracleCoordinator/1"],
    ["ClaimAdjudicator", adjudicatorAddress, "IClaimAdjudicator/1"],
    ["PolicyEconomics", economicsAddress, "IPolicyEconomics/1"],
    ["EvidenceRegistry", evidenceRegistryAddress, "IEvidenceRegistry/1"],
    ["PolicyBenefitsManager", benefitsAddress, "IPolicyBenefitsManager/1"],
    ["HospitalVerificationRegistry", hospitalVerificationRegistryAddress, "IHospitalVerificationRegistry/1"],
    ["BankIdentityRegistry", bankIdentityRegistryAddress, "IBankIdentityRegistry/1"],
  ]) {
    await (
      await deploymentRegistry.registerComponent(
        hre.ethers.id(name),
        address,
        hre.ethers.id(interfaceVersion),
        true
      )
    ).wait();
  }
  console.log("ProtocolDeploymentRegistry deployed to:", deploymentRegistryAddress);
  syncContractAbi();
  const network = await provider.getNetwork();
  const deployment = {
    schemaVersion: 1,
    network: networkName,
    chainId: network.chainId.toString(),
    deployedAt: new Date().toISOString(),
    deploymentBlock,
    benefitsDeploymentBlock,
    deployer: adminWallet.address,
    components: {
      InsuranceManager: contractAddress,
      OracleCoordinator: await insuranceManager.oracleCoordinator(),
      ClaimAdjudicator: adjudicatorAddress,
      PolicyEconomics: economicsAddress,
      EvidenceRegistry: evidenceRegistryAddress,
      PolicyBenefitsManager: benefitsAddress,
      ProtocolDeploymentRegistry: deploymentRegistryAddress,
      HospitalVerificationRegistry: hospitalVerificationRegistryAddress,
      BankIdentityRegistry: bankIdentityRegistryAddress,
    },
  };
  const deploymentsDirectory = process.env.DEPLOYMENT_OUTPUT_DIR || path.resolve(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDirectory, { recursive: true });
  const deploymentPath = path.join(
    deploymentsDirectory,
    `${networkName}-${network.chainId}.json`
  );
  fs.writeFileSync(deploymentPath, `${JSON.stringify(deployment, null, 2)}\n`, "utf8");
  console.log("Deployment manifest written to:", deploymentPath);

  if (isLocalNetwork && process.env.DEPLOY_WRITE_ENV !== "false") {
    syncLocalContractDeployment(
      contractAddress,
      deploymentBlock,
      adjudicatorAddress,
      benefitsAddress,
      benefitsDeploymentBlock,
      economicsAddress,
      evidenceRegistryAddress,
      deploymentRegistryAddress,
      hospitalVerificationRegistryAddress,
      bankIdentityRegistryAddress
    );
    console.log("");
    console.log("The local deployment was synchronized to backend, frontend, and oracle environment files.");
  } else {
    console.log("Environment files were not modified for this non-local deployment.");
  }
  console.log("");
  console.log("CONTRACT_ADDRESS =", contractAddress);
  console.log("CLAIM_ADJUDICATOR_ADDRESS =", adjudicatorAddress);
  console.log("POLICY_BENEFITS_ADDRESS =", benefitsAddress);
  console.log("POLICY_ECONOMICS_ADDRESS =", economicsAddress);
  console.log("EVIDENCE_REGISTRY_ADDRESS =", evidenceRegistryAddress);
  console.log("PROTOCOL_DEPLOYMENT_REGISTRY_ADDRESS =", deploymentRegistryAddress);
  console.log("HOSPITAL_VERIFICATION_REGISTRY_ADDRESS =", hospitalVerificationRegistryAddress);
  console.log("BANK_IDENTITY_REGISTRY_ADDRESS =", bankIdentityRegistryAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
