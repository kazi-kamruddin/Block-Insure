require("dotenv").config();

const dns = require("dns");
const mongoose = require("mongoose");
const { ethers } = require("ethers");
const InsuranceManagerArtifact = require("../abi/InsuranceManager.json");
const OracleCoordinatorArtifact = require("../abi/OracleCoordinator.json");
const ClaimAdjudicatorArtifact = require("../abi/ClaimAdjudicator.json");
const AdminActionLog = require("../models/AdminActionLog");
const Appeal = require("../models/Appeal");
const ClaimSubmissionAttempt = require("../models/ClaimSubmissionAttempt");
const EvidenceAccessLog = require("../models/EvidenceAccessLog");
const File = require("../models/File");
const MockHospitalRecord = require("../models/MockHospitalRecord");
const MockHospitalRecordOracle2 = require("../models/MockHospitalRecordOracle2");
const Notification = require("../models/Notification");
const OracleHealth = require("../models/OracleHealth");
const OracleLog = require("../models/OracleLog");
const RevokedToken = require("../models/RevokedToken");
const User = require("../models/User");
const VotingFinalization = require("../models/VotingFinalization");
const { buildSyntheticRecords } = require("./seedMockData");
const { getPolicyPackageIds } = require("../services/contractQueryService");
const { buildRegistryMerkleRoot } = require("../services/merkleRegistryService");

dns.setDefaultResultOrder("ipv4first");

if (process.env.FORCE_PUBLIC_DNS === "true") {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
}

function requireEnv(name) {
  if (!process.env[name]) {
    throw new Error(`${name} is missing in backEnd/.env`);
  }

  return process.env[name];
}

async function getActiveRoleMembers(contract, role) {
  const grants = await contract.queryFilter(contract.filters.RoleGranted(role));
  const candidates = [
    ...new Set(grants.map((event) => event.args.account.toLowerCase())),
  ];
  const activeChecks = await Promise.all(
    candidates.map((account) => contract.hasRole(role, account))
  );

  return candidates.filter((_, index) => activeChecks[index]);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(requireEnv("RPC_URL"));
  const contract = new ethers.Contract(
    requireEnv("VITE_CONTRACT_ADDRESS"),
    InsuranceManagerArtifact.abi,
    provider
  );
  const coordinator = new ethers.Contract(
    await contract.oracleCoordinator(),
    OracleCoordinatorArtifact.abi,
    provider
  );
  const adjudicator = new ethers.Contract(
    await contract.claimAdjudicator(),
    ClaimAdjudicatorArtifact.abi,
    provider
  );

  const [packageIds, policyCounter, claimCounter, reserveWei] = await Promise.all([
    getPolicyPackageIds(contract),
    contract.policyCounter(),
    contract.claimCounter(),
    provider.getBalance(requireEnv("VITE_CONTRACT_ADDRESS")),
  ]);

  const failures = [];
  if (packageIds.length !== 1) failures.push(`expected 1 package, found ${packageIds.length}`);
  if (policyCounter !== 1n) failures.push(`expected 0 purchased policies, found ${policyCounter - 1n}`);
  if (claimCounter !== 1n) failures.push(`expected 0 claims, found ${claimCounter - 1n}`);
  if (reserveWei < ethers.parseEther("1")) {
    failures.push(`expected at least 1 ETH settlement reserve, found ${ethers.formatEther(reserveWei)} ETH`);
  }

  const registryRoot = await coordinator.currentRegistryRoot();
  if (registryRoot === ethers.ZeroHash) failures.push("expected a published healthcare registry Merkle root");

  const expectedAdmin = new ethers.Wallet(
    requireEnv("ADMIN_PRIVATE_KEY")
  ).address.toLowerCase();
  const expectedAuditors = [
    requireEnv("AUDITOR_WALLET_ADDRESS"),
    process.env.AUDITOR_WALLET_ADDRESS_2,
    process.env.AUDITOR_WALLET_ADDRESS_3,
    process.env.AUDITOR_WALLET_ADDRESS_4,
    "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
    "0x23618e81E3f5CDf7f54C3d65f7fBfB5d82f842fB",
    "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720",
  ]
    .filter(Boolean)
    .map((address) => ethers.getAddress(address).toLowerCase())
    .filter((address, index, all) => all.indexOf(address) === index)
    .slice(0, 4)
    .sort();
  const expectedOracles = [
    new ethers.Wallet(requireEnv("ORACLE_PRIVATE_KEY")).address.toLowerCase(),
    new ethers.Wallet(requireEnv("ORACLE_PRIVATE_KEY_2")).address.toLowerCase(),
  ].sort();
  const [adminRole, auditorRole, oracleRole] = await Promise.all([
    contract.ADMIN_ROLE(),
    contract.AUDITOR_ROLE(),
    contract.ORACLE_ROLE(),
  ]);
  const [activeAdmins, activeAuditors, activeOracles] = await Promise.all([
    getActiveRoleMembers(contract, adminRole),
    getActiveRoleMembers(contract, auditorRole),
    getActiveRoleMembers(contract, oracleRole),
  ]);

  if (
    activeAdmins.length !== 1 ||
    activeAdmins[0] !== expectedAdmin
  ) {
    failures.push(
      `expected only configured Admin ${expectedAdmin}, found ${activeAdmins.join(", ") || "none"}`
    );
  }
  if (
    activeAuditors.length !== expectedAuditors.length ||
    activeAuditors.slice().sort().join(",") !== expectedAuditors.join(",")
  ) {
    failures.push(
      `expected configured Auditors ${expectedAuditors.join(", ")}, found ${activeAuditors.join(", ") || "none"}`
    );
  }
  if (
    activeOracles.length !== expectedOracles.length ||
    activeOracles.slice().sort().join(",") !== expectedOracles.join(",")
  ) {
    failures.push(
      `expected configured Oracle wallets ${expectedOracles.join(", ")}, found ${activeOracles.join(", ") || "none"}`
    );
  }

  for (const auditor of expectedAuditors) {
    const [auditorReputation, auditorVotes] = await Promise.all([
      adjudicator.auditorReputation(auditor),
      adjudicator.auditorTotalVotes(auditor),
    ]);
    if (auditorReputation !== 0n) {
      failures.push(
        `expected uninitialized auditor reputation 0 for ${auditor}, found ${auditorReputation}`
      );
    }
    if (auditorVotes !== 0n) {
      failures.push(`expected 0 auditor votes for ${auditor}, found ${auditorVotes}`);
    }
  }

  await mongoose.connect(requireEnv("MONGODB_URI"));
  try {
    const checks = [
      ["admin action logs", AdminActionLog],
      ["appeals", Appeal],
      ["claim submission attempts", ClaimSubmissionAttempt],
      ["documents", File],
      ["evidence access logs", EvidenceAccessLog],
      ["notifications", Notification],
      ["oracle health records", OracleHealth],
      ["oracle logs", OracleLog],
      ["revoked sessions", RevokedToken],
      ["voting finalizations", VotingFinalization],
    ];

    for (const [label, Model] of checks) {
      const count = await Model.countDocuments({});
      if (count !== 0) failures.push(`expected 0 ${label}, found ${count}`);
    }

    const expectedRegistryCount = buildSyntheticRecords().length;
    const [primaryRegistryCount, oracle2RegistryCount] = await Promise.all([
      MockHospitalRecord.countDocuments({}),
      MockHospitalRecordOracle2.countDocuments({}),
    ]);
    if (primaryRegistryCount !== expectedRegistryCount) {
      failures.push(`expected ${expectedRegistryCount} primary registry records, found ${primaryRegistryCount}`);
    }
    if (oracle2RegistryCount !== expectedRegistryCount) {
      failures.push(`expected ${expectedRegistryCount} oracle 2 registry records, found ${oracle2RegistryCount}`);
    }

    const [primaryMerkle, oracle2Merkle] = await Promise.all([
      buildRegistryMerkleRoot("primary"),
      buildRegistryMerkleRoot("oracle2"),
    ]);
    if (primaryMerkle.rootHash.toLowerCase() !== registryRoot.toLowerCase()) {
      failures.push("primary registry root does not match the on-chain commitment");
    }
    if (oracle2Merkle.rootHash.toLowerCase() !== registryRoot.toLowerCase()) {
      failures.push("Oracle 2 clean registry root does not match the on-chain commitment");
    }

    const userCount = await User.countDocuments({});
    if (userCount < 2) failures.push(`expected configured role users, found ${userCount}`);
  } finally {
    await mongoose.connection.close();
    provider.destroy();
  }

  if (failures.length > 0) {
    throw new Error(`Clean-start verification failed: ${failures.join("; ")}`);
  }

  console.log("Clean-start verification passed: one Admin, four uninitialized Auditors, two Oracles, one package, zero policies/claims/votes, funded settlement reserve, no prior runtime activity, and a published healthcare registry baseline.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
