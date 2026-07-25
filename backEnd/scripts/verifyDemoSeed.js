require("dotenv").config();

const axios = require("axios");
const mongoose = require("mongoose");
const { ethers } = require("ethers");
const OracleLog = require("../models/OracleLog");
const User = require("../models/User");
const VotingFinalization = require("../models/VotingFinalization");
const {
  getContractBalance,
  getReadOnlyContract,
  getRegistrySnapshot,
} = require("../services/contractService");
const { getPolicyPackageIds } = require("../services/contractQueryService");

const requiredEnv = [
  "MONGODB_URI",
  "RPC_URL",
  "VITE_CONTRACT_ADDRESS",
  "ADMIN_PRIVATE_KEY",
];

const claimStatuses = [
  "SUBMITTED",
  "DUPLICATE_CHECKED",
  "FRAUD_FLAGGED",
  "ORACLE_PENDING",
  "ORACLE_VERIFIED",
  "ORACLE_FAILED",
  "MANUAL_REVIEW",
  "APPROVED",
  "REJECTED",
  "SETTLED",
  "CLOSED",
];

const policyStatuses = [
  "PENDING_PAYMENT",
  "ACTIVE",
  "GRACE_PERIOD",
  "LAPSED",
  "CANCELLED",
  "EXPIRED",
  "RENEWED",
];

const results = {
  criticalFailures: 0,
  warnings: 0,
};

function pass(message) {
  console.log(`✅ ${message}`);
}

function warn(message) {
  results.warnings += 1;
  console.log(`⚠️ ${message}`);
}

function fail(message) {
  results.criticalFailures += 1;
  console.log(`❌ ${message}`);
}

async function checkDefenseSummaryEndpoint() {
  const baseUrl = process.env.BACKEND_URL || "http://localhost:5000";
  const token = process.env.DEMO_ADMIN_JWT;

  if (!token) {
    warn("Defense summary endpoint not called; DEMO_ADMIN_JWT is not set");
    return;
  }

  try {
    await axios.get(`${baseUrl}/api/admin/evaluation/defense-summary`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 5000,
    });
    pass("Defense summary endpoint works");
  } catch (error) {
    fail(`Defense summary endpoint failed: ${error.message}`);
  }
}

async function verifyRoles(contract) {
  const adminWallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY);
  const adminRole = await contract.ADMIN_ROLE();
  const oracleRole = await contract.ORACLE_ROLE();
  const auditorRole = await contract.AUDITOR_ROLE();

  if (await contract.hasRole(adminRole, adminWallet.address)) {
    pass("Admin role configured");
  } else {
    fail(`Admin role missing for ${adminWallet.address}`);
  }

  const oracleKeys = [
    process.env.ORACLE_PRIVATE_KEY,
    process.env.ORACLE2_PRIVATE_KEY,
    process.env.ORACLE_PRIVATE_KEY_2,
  ].filter(Boolean);

  if (oracleKeys.length === 0) {
    warn("Oracle private keys are not configured in env");
  }

  for (const [index, privateKey] of oracleKeys.entries()) {
    const wallet = new ethers.Wallet(privateKey);
    if (await contract.hasRole(oracleRole, wallet.address)) {
      pass(`Oracle ${index + 1} role configured`);
    } else {
      warn(`Oracle ${index + 1} role missing for ${wallet.address}`);
    }
  }

  const auditorKeys = [
    process.env.AUDITOR_PRIVATE_KEY,
    process.env.AUDITOR2_PRIVATE_KEY,
    process.env.AUDITOR_PRIVATE_KEY_2,
  ].filter(Boolean);

  if (auditorKeys.length === 0) {
    warn("Auditor private keys are not configured in env");
  }

  for (const [index, privateKey] of auditorKeys.entries()) {
    const wallet = new ethers.Wallet(privateKey);
    if (await contract.hasRole(auditorRole, wallet.address)) {
      pass(`Auditor ${index + 1} role configured`);
    } else {
      warn(`Auditor ${index + 1} role missing for ${wallet.address}`);
    }
  }
}

async function main() {
  for (const key of requiredEnv) {
    if (process.env[key]) {
      pass(`${key} present`);
    } else {
      fail(`${key} missing`);
    }
  }

  if (results.criticalFailures > 0) {
    process.exit(1);
  }

  const contract = getReadOnlyContract();

  try {
    await contract.packageCounter();
    pass("Contract reachable");
  } catch (error) {
    fail(`Contract unreachable: ${error.message}`);
    contract.runner?.provider?.destroy?.();
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    pass("MongoDB reachable");
  } catch (error) {
    fail(`MongoDB unreachable: ${error.message}`);
    contract.runner?.provider?.destroy?.();
    process.exit(1);
  }

  await verifyRoles(contract);

  const packageIds = await getPolicyPackageIds(contract);
  const packages = await Promise.all(
    packageIds.map((packageId) => contract.getPolicyPackage(packageId))
  );
  const activePackages = packages.filter((policyPackage) => policyPackage.isActive);

  if (activePackages.length > 0) pass("At least one active package found");
  else fail("No active package found");

  const nextPolicyId = Number(await contract.policyCounter());
  const purchasedPolicyCount = Math.max(nextPolicyId - 1, 0);

  if (purchasedPolicyCount > 0) pass("At least one purchased policy found");
  else fail("No purchased policy found");

  if (purchasedPolicyCount > 0) {
    const policy = await contract.getPolicy(1);
    const status = await contract.getEffectivePolicyStatus(1);
    const hasLifecycleFields =
      policy.premiumAmount !== undefined &&
      policy.nextPremiumDueDate !== undefined &&
      policy.gracePeriodEnd !== undefined &&
      policy.totalPremiumPaid !== undefined &&
      policy.installmentsPaid !== undefined;

    if (hasLifecycleFields) {
      pass(`Policy premium lifecycle fields exist (${policyStatuses[Number(status)]})`);
    } else {
      fail("Policy premium lifecycle fields missing");
    }
  }

  const nextClaimId = Number(await contract.claimCounter());
  const claimCounts = Object.fromEntries(claimStatuses.map((status) => [status, 0]));
  let settledClaimFound = false;
  let votingReadyClaimFound = false;

  for (let claimId = 1; claimId < nextClaimId; claimId += 1) {
    const claim = await contract.getClaim(claimId);
    const status = claimStatuses[Number(claim.status)] || "UNKNOWN";
    claimCounts[status] = (claimCounts[status] || 0) + 1;

    if (status === "ORACLE_FAILED" || status === "MANUAL_REVIEW") {
      votingReadyClaimFound = true;
    }

    if (status === "SETTLED" || status === "CLOSED") {
      try {
        await contract.getSettlementRecord(claimId);
        settledClaimFound = true;
      } catch {
        warn(`Settlement data missing for settled/closed claim #${claimId}`);
      }
    }
  }

  if (nextClaimId > 1) pass("Demo claims found");
  else fail("No demo claims found");

  const keyStatuses = ["DUPLICATE_CHECKED", "ORACLE_PENDING", "ORACLE_VERIFIED", "ORACLE_FAILED", "MANUAL_REVIEW", "SETTLED", "CLOSED"];
  const missingStatuses = keyStatuses.filter((status) => !claimCounts[status]);

  if (missingStatuses.length === 0) {
    pass("Demo claims cover key statuses");
  } else {
    warn(`Demo claims missing statuses: ${missingStatuses.join(", ")}`);
  }

  const oracleLogs = await OracleLog.find({}).lean();
  if (oracleLogs.length > 0) pass("Oracle logs found");
  else warn("Oracle logs missing");

  const oracle2Logs = oracleLogs.filter((log) =>
    String(log.oracleType || log.responseData?.oracleInstanceId || "")
      .toLowerCase()
      .includes("2")
  );
  if (oracle2Logs.length > 0) pass("Oracle 2 logs found");
  else warn("Oracle 2 logs missing");

  if (votingReadyClaimFound) pass("Auditor voting-ready claim found");
  else warn("No auditor voting-ready claim found");

  if (settledClaimFound) pass("Settlement data exists for settled claims");
  else fail("No settled claim found");

  const votingFinalizations = await VotingFinalization.countDocuments({});
  if (votingFinalizations > 0) pass("Voting finalization data found");
  else warn("Voting finalization data missing");

  const users = await User.countDocuments({});
  if (users > 0) pass("Backend demo users exist");
  else warn("No backend users found; run demo population/login seeding if needed");

  try {
    await getContractBalance();
    const snapshot = await getRegistrySnapshot(contract);
    const root = snapshot.root || snapshot[0];

    if (root && root !== ethers.ZeroHash) pass("Merkle root pushed");
    else warn("Merkle root not pushed");
  } catch (error) {
    warn(`Reserve or registry check failed: ${error.message}`);
  }

  await checkDefenseSummaryEndpoint();
  await mongoose.connection.close();
  contract.runner?.provider?.destroy?.();

  if (results.criticalFailures > 0) {
    console.log(`\n❌ Demo verification failed with ${results.criticalFailures} critical issue(s).`);
    process.exitCode = 1;
  } else {
    console.log(`\n✅ Demo verification completed with ${results.warnings} warning(s).`);
  }
}

main().catch(async (error) => {
  fail(error.message);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
