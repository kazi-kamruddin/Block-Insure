const dns = require("node:dns");
const fs = require("node:fs");
const path = require("node:path");

const dotenv = require("../backEnd/node_modules/dotenv");
const mongoose = require("../backEnd/node_modules/mongoose");
const { ethers } = require("../backEnd/node_modules/ethers");

const projectRoot = path.resolve(__dirname, "..");
const resultsDirectory = path.join(projectRoot, "verification-results");
const requestedOutput = process.env.E2E_STATE_OUTPUT || "e2e-post-run-state.json";
const outputPath = path.resolve(resultsDirectory, requestedOutput);
if (path.dirname(outputPath) !== resultsDirectory) {
  throw new Error("E2E_STATE_OUTPUT must be a filename inside verification-results");
}

dotenv.config({ path: path.join(projectRoot, "backEnd", ".env"), quiet: true });
dns.setDefaultResultOrder("ipv4first");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

function databaseUri(source, databaseName) {
  const url = new URL(source);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function inventoryDatabase(uri, databaseName) {
  const connection = await mongoose.createConnection(uri, {
    serverSelectionTimeoutMS: 20_000,
  }).asPromise();
  try {
    const collections = await connection.db.listCollections({}, { nameOnly: true }).toArray();
    const counts = {};
    for (const collection of collections.sort((left, right) => left.name.localeCompare(right.name))) {
      counts[collection.name] = await connection.db
        .collection(collection.name)
        .countDocuments({});
    }

    const aggregate = async (collectionName, field) => {
      if (!counts[collectionName]) return [];
      const values = await connection.db.collection(collectionName).aggregate([
        { $match: { [field]: { $exists: true } } },
        { $group: { _id: `$${field}`, count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
      ]).toArray();
      return values.map(({ _id, count }) => ({
        value: _id == null ? "(null)" : String(_id),
        count,
      }));
    };

    return {
      database: databaseName,
      totalDocuments: Object.values(counts).reduce((total, count) => total + count, 0),
      counts,
      distributions: {
        userRoles: await aggregate("users", "role"),
        mandateStatuses: await aggregate("eftmandates", "status"),
        paymentStatuses: await aggregate("banktransactions", "status"),
        paymentTypes: await aggregate("banktransactions", "type"),
        hospitalVerificationOutcomes: await aggregate("hospitalclaimverifications", "outcome"),
        oracleRiskLevels: await aggregate("oraclelogs", "riskLevel"),
        oracleVerified: await aggregate("oraclelogs", "verified"),
        evidenceEncrypted: await aggregate("files", "encrypted"),
      },
    };
  } finally {
    await connection.close();
  }
}

async function eventCounts(provider, address, artifact, fromBlock) {
  if (!address || !ethers.isAddress(address)) return {};
  const code = await provider.getCode(address);
  if (code === "0x") return {};
  const contractInterface = new ethers.Interface(artifact.abi);
  const logs = await provider.getLogs({ address, fromBlock, toBlock: "latest" });
  const counts = {};
  for (const log of logs) {
    try {
      const parsed = contractInterface.parseLog(log);
      counts[parsed.name] = (counts[parsed.name] || 0) + 1;
    } catch {
      counts.UNPARSED = (counts.UNPARSED || 0) + 1;
    }
  }
  return counts;
}

async function main() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error("MONGODB_URI is required");
  const selectedDatabase = new URL(mongoUri).pathname.replace(/^\//, "");
  if (selectedDatabase !== "block_insure_e2e") {
    throw new Error(`Refusing E2E capture for non-isolated database: ${selectedDatabase}`);
  }

  const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
  const rpc = new URL(rpcUrl);
  if (!["127.0.0.1", "localhost"].includes(rpc.hostname)) {
    throw new Error(`Refusing E2E capture for non-local RPC host: ${rpc.hostname}`);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  try {
    const network = await provider.getNetwork();
    if (network.chainId !== 31337n) {
      throw new Error(`Refusing E2E capture for chain ID ${network.chainId}`);
    }

    const managerArtifact = require("../backEnd/abi/InsuranceManager.json");
    const managerAddress = process.env.VITE_CONTRACT_ADDRESS;
    const manager = new ethers.Contract(managerAddress, managerArtifact.abi, provider);
    const nextPolicyId = Number(await manager.policyCounter());
    const nextClaimId = Number(await manager.claimCounter());
    const policyStatuses = [
      "PENDING_PAYMENT",
      "ACTIVE",
      "GRACE_PERIOD",
      "LAPSED",
      "CANCELLED",
      "EXPIRED",
      "RENEWED",
    ];
    const claimStatuses = [
      "SUBMITTED",
      "DUPLICATE_CHECKED",
      "FRAUD_FLAGGED",
      "ORACLE_PENDING",
      "ORACLE_VERIFIED",
      "ORACLE_FAILED",
      "MANUAL_REVIEW",
      "PAYOUT_READY",
      "REJECTED",
      "SETTLED",
      "CLOSED",
      "FUNDING_REQUIRED",
      "APPEALED",
    ];

    const policies = [];
    for (let policyId = 1; policyId < nextPolicyId; policyId += 1) {
      const policy = await manager.getPolicy(policyId);
      policies.push({
        policyId,
        status: policyStatuses[Number(policy.status)],
        active: policy.isActive,
        premiumPaidWei: policy.totalPremiumPaid.toString(),
        installmentsPaid: Number(policy.installmentsPaid),
      });
    }

    const claims = [];
    for (let claimId = 1; claimId < nextClaimId; claimId += 1) {
      const claim = await manager.getClaim(claimId);
      claims.push({
        claimId,
        policyId: Number(claim.policyId),
        status: claimStatuses[Number(claim.status)],
        amountWei: claim.claimAmount.toString(),
        evidenceCidPresent: Boolean(claim.documentCID),
        evidenceHashPresent: claim.documentHash !== ethers.ZeroHash,
      });
    }

    const fromBlock = Number(process.env.CONTRACT_DEPLOYMENT_BLOCK || 0);
    const oracleCoordinatorAddress = await manager.oracleCoordinator();
    const contracts = [
      ["InsuranceManager", managerAddress, managerArtifact],
      ["OracleCoordinator", oracleCoordinatorAddress, require("../backEnd/abi/OracleCoordinator.json")],
      ["ClaimAdjudicator", process.env.CLAIM_ADJUDICATOR_ADDRESS, require("../backEnd/abi/ClaimAdjudicator.json")],
      ["HospitalVerificationRegistry", process.env.HOSPITAL_VERIFICATION_REGISTRY_ADDRESS, require("../backEnd/abi/HospitalVerificationRegistry.json")],
      ["BankIdentityRegistry", process.env.BANK_IDENTITY_REGISTRY_ADDRESS, require("../backEnd/abi/BankIdentityRegistry.json")],
    ];
    const events = {};
    for (const [name, address, artifact] of contracts) {
      events[name] = await eventCounts(provider, address, artifact, fromBlock);
    }

    const result = {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      safety: {
        frontendUrl: "http://localhost:5173",
        backendUrl: "http://localhost:5000",
        rpcUrl,
        chainId: Number(network.chainId),
        mongoDatabase: selectedDatabase,
        originalDatabase: "block_insure",
        wallets: "Hardhat default development accounts",
        secretsRedacted: true,
      },
      mongo: {
        e2e: await inventoryDatabase(mongoUri, selectedDatabase),
        original: await inventoryDatabase(databaseUri(mongoUri, "block_insure"), "block_insure"),
      },
      chain: {
        managerAddress,
        latestBlock: await provider.getBlockNumber(),
        policyCount: policies.length,
        claimCount: claims.length,
        managerBalanceWei: (await provider.getBalance(managerAddress)).toString(),
        policies,
        claims,
        eventCounts: events,
      },
    };

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`[E2E capture] Sanitized reconciliation written to ${outputPath}`);
  } finally {
    provider.destroy();
  }
}

main().catch((error) => {
  console.error(`[E2E capture] ${error.message}`);
  process.exitCode = 1;
});
