require("dotenv").config();

const dns = require("dns");
const mongoose = require("mongoose");
const { ethers } = require("ethers");
const InsuranceManagerArtifact = require("../abi/InsuranceManager.json");
const File = require("../models/File");
const MockHospitalRecord = require("../models/MockHospitalRecord");
const MockHospitalRecordOracle2 = require("../models/MockHospitalRecordOracle2");
const Notification = require("../models/Notification");
const OracleLog = require("../models/OracleLog");
const VotingFinalization = require("../models/VotingFinalization");
const { buildSyntheticRecords } = require("./seedMockData");
const {
  assignEvidenceChainLink,
} = require("../services/evidenceChainService");
const { calculateTextSHA256 } = require("../services/hashService");
const {
  buildRegistryMerkleProof,
  exportMerkleRoot,
} = require("../services/merkleRegistryService");
const { buildRiskAssessment } = require("../services/riskScoringService");
const { buildVerificationComparison } = require("../controllers/mockHospitalController");

dns.setDefaultResultOrder("ipv4first");

if (process.env.FORCE_PUBLIC_DNS === "true") {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
}

const DEFAULT_LOCAL_KEYS = {
  user:
    "0x59c6995e998f97a5a0044966f094538ea59f3b31f82b83fe5c7f3099b6a6c0e8",
  auditor:
    "0x7c8521182947f39d4aef26d88960bdfecb9e09ee03e89d6eac8c4c1245773b8a",
  auditor2:
    "0x47e179ec197488bf5690dc5d2c3c13573a489ed1544ca59571c8d5f5169d5a0",
  oracle2:
    "0x8b3a350cf5c34c9194ca3a545d9d16a135e472d8e2f8f8a68b453c7b5f6d7e76",
};

const CLAIM_STATUS = [
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

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is missing in backend/.env`);
  }

  return value;
}

function getOptionalPrivateKey(envName, fallbackName) {
  const value = process.env[envName];

  if (value) {
    return value;
  }

  if (process.env.DEMO_USE_HARDHAT_ACCOUNTS === "false") {
    return "";
  }

  return DEFAULT_LOCAL_KEYS[fallbackName] || "";
}

function getWallet(privateKey, provider, label) {
  if (!privateKey) {
    throw new Error(`${label} private key is not configured`);
  }

  return new ethers.Wallet(privateKey, provider);
}

function normalizeBytes32(value, fallbackText) {
  if (/^0x[a-fA-F0-9]{64}$/.test(String(value || ""))) {
    return value;
  }

  return ethers.keccak256(ethers.toUtf8Bytes(fallbackText));
}

function getArgValue(name, fallback = "") {
  const index = process.argv.indexOf(name);

  if (index === -1 || index + 1 >= process.argv.length) {
    return fallback;
  }

  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function toClaimStatusName(claim) {
  return CLAIM_STATUS[Number(claim.status)] || "UNKNOWN";
}

function getEventArg(receipt, contract, eventName, argName) {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);

      if (parsed?.name === eventName) {
        return parsed.args[argName];
      }
    } catch (_) {
      // Ignore unrelated logs.
    }
  }

  return null;
}

async function waitFor(txPromise) {
  const tx = await txPromise;
  return tx.wait();
}

async function grantRoleIfMissing(contract, roleHash, walletAddress, label) {
  const address = ethers.getAddress(walletAddress);
  const hasRole = await contract.hasRole(roleHash, address);

  if (hasRole) {
    console.log(`${label} already granted to ${address}`);
    return;
  }

  console.log(`Granting ${label} to ${address}`);
  await waitFor(contract.grantProjectRole(roleHash, address));
}

async function resetDemoCollections() {
  console.log("Resetting demo MongoDB collections...");
  await Promise.all([
    File.deleteMany({}),
    Notification.deleteMany({}),
    OracleLog.deleteMany({}),
    VotingFinalization.deleteMany({}),
  ]);
}

async function seedRegistry() {
  console.log("Seeding synthetic healthcare registries...");
  const records = buildSyntheticRecords();

  await MockHospitalRecord.deleteMany({});
  await MockHospitalRecordOracle2.deleteMany({});
  await MockHospitalRecord.insertMany(records);

  const oracle2Records = records.map((record, index) => {
    if (index !== 0) {
      return record;
    }

    return {
      ...record,
      invoiceStatus: "USED",
      recordStatus: "USED",
      fraudLabel: "USED_INVOICE",
      fraudSignals: {
        ...record.fraudSignals,
        usedInvoice: true,
      },
      previousClaimCount: 2,
      syntheticSource: "demo-oracle2-independent-snapshot",
    };
  });

  await MockHospitalRecordOracle2.insertMany(oracle2Records);

  return records;
}

async function createEvidenceDocument({ claimId, wallet, label, documentType }) {
  const fileRecord = await File.create({
    claimId: claimId.toString(),
    uploaderWallet: wallet.address.toLowerCase(),
    originalName: `${label}.pdf`,
    mimeType: "application/pdf",
    sha256Hash: calculateTextSHA256(`${claimId}:${label}:bytes`),
    ipfsCID: `QmDemo${calculateTextSHA256(`${claimId}:${label}:cid`).slice(0, 38)}`,
    documentType,
  });

  await assignEvidenceChainLink(fileRecord, claimId.toString());
}

async function purchasePolicy(contract, packageId) {
  const policyPackage = await contract.getPolicyPackage(packageId);

  if (!policyPackage.isActive) {
    throw new Error(`Policy package ${packageId} is not active`);
  }

  const receipt = await waitFor(
    contract.purchasePolicy(packageId, {
      value: policyPackage.premiumAmount,
    })
  );

  return getEventArg(receipt, contract, "PolicyPurchased", "policyId").toString();
}

async function submitClaimFromRecord({
  contract,
  policyId,
  record,
  amountEth,
  invoiceHash,
  documentSeed,
  cidSeed,
}) {
  const policy = await contract.getPolicy(policyId);
  const claimAmountEth = amountEth || record.billAmount;
  const documentHash = normalizeBytes32("", `demo-document-${documentSeed}`);
  const documentCID = `QmDemoClaim${calculateTextSHA256(cidSeed).slice(0, 34)}`;
  const receipt = await waitFor(
    contract.submitClaim(
      policyId,
      ethers.parseEther(claimAmountEth.toString()),
      policy.startDate,
      record.treatmentType,
      record.hospitalId,
      invoiceHash || record.invoiceHash,
      documentHash,
      documentCID
    )
  );

  return {
    claimId: getEventArg(receipt, contract, "ClaimSubmitted", "claimId").toString(),
    documentHash,
  };
}

function getHigherRiskLevel(...levels) {
  const rank = { LOW: 1, MEDIUM: 2, HIGH: 3, FRAUD_FLAGGED: 3, ORACLE_FAILED: 3 };

  return levels.reduce((highest, level) => {
    return (rank[level] || 0) > (rank[highest] || 0) ? level : highest;
  }, "LOW");
}

function normalizeHash(value) {
  return String(value || "").trim().toLowerCase();
}

async function verifyAgainstRegistry({
  claim,
  requestId,
  oracleType,
  registrySnapshot,
  contract,
}) {
  const RegistryModel =
    registrySnapshot === "oracle2" ? MockHospitalRecordOracle2 : MockHospitalRecord;
  const claimAmountWei = claim.claimAmount.toString();
  const claimAmountEth = ethers.formatEther(claim.claimAmount);
  const invoiceHash = normalizeHash(claim.invoiceHash);
  const record = await RegistryModel.findOne({ invoiceHash }).lean();
  const records = await RegistryModel.find().lean();
  const comparison = buildVerificationComparison({
    record,
    hospitalId: claim.hospitalId,
    invoiceHash,
    claimAmountEth,
    claimAmountWei,
    claimType: claim.claimType,
    incidentDate: claim.incidentDate.toString(),
  });
  const riskAssessment = await buildRiskAssessment({
    record,
    comparison,
    query: {
      hospitalId: claim.hospitalId,
      invoiceHash,
      claimAmountEth,
      claimAmountWei,
      claimType: claim.claimType,
      incidentDate: claim.incidentDate.toString(),
    },
    records,
  });
  const merkleProof = await buildRegistryMerkleProof({
    invoiceHash,
    registrySnapshot,
  });
  const comparisonVerified = record && comparison.blockingFailureCount === 0;
  const verified =
    Boolean(comparisonVerified) &&
    riskAssessment.recommendation !== "REJECT_ORACLE_VERIFICATION";
  const comparisonRiskLevel = comparisonVerified
    ? comparison.warningFailureCount > 0
      ? "MEDIUM"
      : "LOW"
    : comparison.blockingFailures.some((failure) => failure.severity === "HIGH")
      ? "HIGH"
      : "MEDIUM";
  const riskLevel = getHigherRiskLevel(comparisonRiskLevel, riskAssessment.riskLevel);
  const snapshot = await contract.getRegistrySnapshot();

  return {
    success: true,
    verified,
    riskLevel,
    message: verified
      ? "Synthetic healthcare registry record matched"
      : "Synthetic healthcare registry verification failed",
    comparison,
    riskAssessment,
    merkleProof,
    query: {
      hospitalId: claim.hospitalId,
      invoiceHash,
      claimAmountEth,
      claimAmountWei,
      claimType: claim.claimType,
      incidentDate: claim.incidentDate.toString(),
    },
    registrySnapshot,
    record,
    registryCommitment: {
      localRoot: merkleProof.rootHash,
      onChainRoot: snapshot.root || snapshot[0],
      snapshotTimestamp: (snapshot.timestamp || snapshot[1]).toString(),
      snapshotBlock: (snapshot.blockNumber || snapshot[2]).toString(),
    },
    requestId: requestId.toString(),
    oracleType,
  };
}

async function submitOracleConfirmation({
  requestId,
  claimId,
  oracleWallet,
  oracleInstanceId,
  registrySnapshot,
  oracleType,
  contractAddress,
  provider,
}) {
  const oracleContract = new ethers.Contract(
    contractAddress,
    InsuranceManagerArtifact.abi,
    oracleWallet
  );
  const claim = await oracleContract.getClaim(claimId);
  const hospitalVerification = await verifyAgainstRegistry({
    claim,
    requestId,
    oracleType,
    registrySnapshot,
    contract: oracleContract,
  });
  const oracleResponse = {
    requestId: requestId.toString(),
    claimId: claimId.toString(),
    oracleType,
    queryData: hospitalVerification.query,
    hospitalVerification,
    merkleRootMatchesChain:
      normalizeHash(hospitalVerification.merkleProof.rootHash) ===
      normalizeHash(hospitalVerification.registryCommitment.onChainRoot),
    registryCommitment: hospitalVerification.registryCommitment,
    verified: hospitalVerification.verified,
    riskLevel: hospitalVerification.riskLevel,
    remarks: hospitalVerification.message,
    checkedAt: new Date().toISOString(),
    oracleInstanceId,
    oracleWallet: oracleWallet.address,
    registrySnapshot,
  };
  const resultHash = ethers.keccak256(
    ethers.toUtf8Bytes(JSON.stringify(oracleResponse))
  );
  const startedAt = Date.now();
  const receipt = await waitFor(
    oracleContract.submitOracleResult(
      requestId,
      oracleResponse.verified,
      resultHash,
      oracleResponse.riskLevel,
      oracleResponse.remarks
    )
  );

  await OracleLog.create({
    requestId: requestId.toString(),
    claimId: claimId.toString(),
    oracleType,
    queryData: oracleResponse.queryData,
    responseData: oracleResponse,
    resultHash,
    verified: oracleResponse.verified,
    riskLevel: oracleResponse.riskLevel,
    submittedTxHash: receipt.hash,
    responseTimeMs: Date.now() - startedAt,
  });

  console.log(
    `Oracle ${oracleInstanceId} logged request ${requestId}: ${oracleResponse.verified ? "verified" : "failed"}`
  );
}

async function requestOracle(contract, claimId) {
  const receipt = await waitFor(contract.requestOracleVerification(claimId));
  return getEventArg(receipt, contract, "OracleRequested", "requestId").toString();
}

async function runOracleQuorum({
  adminContract,
  provider,
  contractAddress,
  claimId,
  oracleWallets,
}) {
  const requestId = await requestOracle(adminContract, claimId);

  await submitOracleConfirmation({
    requestId,
    claimId,
    oracleWallet: oracleWallets[0],
    oracleInstanceId: "1",
    registrySnapshot: "primary",
    oracleType: "HOSPITAL",
    contractAddress,
    provider,
  });

  await submitOracleConfirmation({
    requestId,
    claimId,
    oracleWallet: oracleWallets[1],
    oracleInstanceId: "2",
    registrySnapshot: "oracle2",
    oracleType: "HOSPITAL",
    contractAddress,
    provider,
  });

  return requestId;
}

async function createClaimScenario({ userContract, userWallet, record, packageId, label }) {
  const policyId = await purchasePolicy(userContract, packageId);
  const claim = await submitClaimFromRecord({
    contract: userContract,
    policyId,
    record,
    documentSeed: label,
    cidSeed: label,
  });

  await createEvidenceDocument({
    claimId: claim.claimId,
    wallet: userWallet,
    label: `${label}-invoice`,
    documentType: "CLAIM_DOCUMENT",
  });
  await createEvidenceDocument({
    claimId: claim.claimId,
    wallet: userWallet,
    label: `${label}-discharge-summary`,
    documentType: "SUPPORTING_DOCUMENT",
  });

  return claim.claimId;
}

async function main() {
  const rpcUrl = requireEnv("RPC_URL");
  const mongodbUri = requireEnv("MONGODB_URI");
  const contractAddress = requireEnv("VITE_CONTRACT_ADDRESS");
  const adminPrivateKey = requireEnv("ADMIN_PRIVATE_KEY");
  const oraclePrivateKey = requireEnv("ORACLE_PRIVATE_KEY");
  const oracle2PrivateKey =
    process.env.ORACLE_PRIVATE_KEY_2 ||
    getOptionalPrivateKey("DEMO_ORACLE_PRIVATE_KEY_2", "oracle2");
  const userPrivateKey = getOptionalPrivateKey("DEMO_USER_PRIVATE_KEY", "user");
  const auditorPrivateKey =
    process.env.AUDITOR_PRIVATE_KEY ||
    getOptionalPrivateKey("DEMO_AUDITOR_PRIVATE_KEY", "auditor");
  const auditor2PrivateKey = getOptionalPrivateKey(
    "DEMO_AUDITOR_PRIVATE_KEY_2",
    "auditor2"
  );
  const packageId = getArgValue("--package", process.env.DEMO_PACKAGE_ID || "1");

  await mongoose.connect(mongodbUri);

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const adminWallet = getWallet(adminPrivateKey, provider, "Admin");
    const userWallet = getWallet(userPrivateKey, provider, "Demo user");
    const oracleWallet = getWallet(oraclePrivateKey, provider, "Oracle 1");
    const oracle2Wallet = getWallet(oracle2PrivateKey, provider, "Oracle 2");
    const auditorWallet = getWallet(auditorPrivateKey, provider, "Auditor 1");
    const auditor2Wallet = getWallet(auditor2PrivateKey, provider, "Auditor 2");
    const adminContract = new ethers.Contract(
      contractAddress,
      InsuranceManagerArtifact.abi,
      adminWallet
    );
    const userContract = new ethers.Contract(
      contractAddress,
      InsuranceManagerArtifact.abi,
      userWallet
    );
    const auditorContract = new ethers.Contract(
      contractAddress,
      InsuranceManagerArtifact.abi,
      auditorWallet
    );
    const auditor2Contract = new ethers.Contract(
      contractAddress,
      InsuranceManagerArtifact.abi,
      auditor2Wallet
    );

    if (!hasFlag("--keep-demo-db")) {
      await resetDemoCollections();
    }

    const records = await seedRegistry();
    const adminRole = await adminContract.ADMIN_ROLE();
    const oracleRole = await adminContract.ORACLE_ROLE();
    const auditorRole = await adminContract.AUDITOR_ROLE();
    const adminHasRole = await adminContract.hasRole(adminRole, adminWallet.address);

    if (!adminHasRole) {
      throw new Error("ADMIN_PRIVATE_KEY is not an on-chain admin for this contract");
    }

    await grantRoleIfMissing(adminContract, oracleRole, oracleWallet.address, "ORACLE_ROLE");
    await grantRoleIfMissing(adminContract, oracleRole, oracle2Wallet.address, "ORACLE_ROLE");
    await grantRoleIfMissing(adminContract, auditorRole, auditorWallet.address, "AUDITOR_ROLE");
    await grantRoleIfMissing(adminContract, auditorRole, auditor2Wallet.address, "AUDITOR_ROLE");

    await waitFor(adminContract.updateAuditorReputation(auditorWallet.address, 80));
    await waitFor(adminContract.updateAuditorReputation(auditor2Wallet.address, 55));

    const contractBalance = await provider.getBalance(contractAddress);

    if (contractBalance < ethers.parseEther("1")) {
      console.log("Funding contract reserve with 3 ETH...");
      await waitFor(adminContract.fundContract({ value: ethers.parseEther("3") }));
    }

    const merkleRoot = await exportMerkleRoot();
    await waitFor(adminContract.updateRegistryMerkleRoot(merkleRoot));
    console.log("Registry Merkle root pushed on-chain:", merkleRoot);

    const oracleWallets = [oracleWallet, oracle2Wallet];
    const settledRecord = records.find(
      (record) =>
        record.fraudLabel === "LEGITIMATE" &&
        record.invoiceNumber !== "INV-HOSP-001-001"
    );
    const failedRecord = records.find((record) => record.fraudLabel === "USED_INVOICE");
    const appealedRecord = records.find(
      (record) =>
        record.fraudLabel === "LEGITIMATE" &&
        record.invoiceNumber !== settledRecord.invoiceNumber
    );

    console.log("Creating settled claim scenario...");
    const settledClaimId = await createClaimScenario({
      userContract,
      userWallet,
      record: settledRecord,
      packageId,
      label: "settled-claim",
    });
    await runOracleQuorum({
      adminContract,
      provider,
      contractAddress,
      claimId: settledClaimId,
      oracleWallets,
    });
    await waitFor(adminContract.approveClaim(settledClaimId));
    await waitFor(adminContract.settleClaim(settledClaimId));
    await waitFor(adminContract.closeClaim(settledClaimId));

    console.log("Creating oracle-failed/manual-review scenario...");
    const failedClaimId = await createClaimScenario({
      userContract,
      userWallet,
      record: failedRecord,
      packageId,
      label: "failed-claim",
    });
    await runOracleQuorum({
      adminContract,
      provider,
      contractAddress,
      claimId: failedClaimId,
      oracleWallets,
    });
    await waitFor(adminContract.sendToManualReview(failedClaimId));
    await waitFor(auditorContract.castVote(failedClaimId, 2));
    await waitFor(auditor2Contract.castVote(failedClaimId, 2));
    await waitFor(
      adminContract.rejectClaim(
        failedClaimId,
        normalizeBytes32("", "demo-rejected-after-auditor-consensus")
      )
    );

    console.log("Creating open manual-review duplicate scenario...");
    const duplicatePolicyId = await purchasePolicy(userContract, packageId);
    const duplicateClaim = await submitClaimFromRecord({
      contract: userContract,
      policyId: duplicatePolicyId,
      record: settledRecord,
      invoiceHash: settledRecord.invoiceHash,
      documentSeed: "duplicate-claim",
      cidSeed: "duplicate-claim",
    });
    await createEvidenceDocument({
      claimId: duplicateClaim.claimId,
      wallet: userWallet,
      label: "duplicate-claim-extra-evidence",
      documentType: "SUPPORTING_DOCUMENT",
    });
    await waitFor(adminContract.sendToManualReview(duplicateClaim.claimId));

    console.log("Creating appeal/reopen scenario...");
    const appealedClaimId = await createClaimScenario({
      userContract,
      userWallet,
      record: appealedRecord,
      packageId,
      label: "appealed-claim",
    });
    await waitFor(
      adminContract.rejectClaim(
        appealedClaimId,
        normalizeBytes32("", "demo-initial-rejection-before-appeal")
      )
    );
    await waitFor(
      userContract.submitAppeal(
        appealedClaimId,
        calculateTextSHA256("demo appeal reason")
      )
    );
    await waitFor(adminContract.reopenClaimAfterAppeal(appealedClaimId));
    await runOracleQuorum({
      adminContract,
      provider,
      contractAddress,
      claimId: appealedClaimId,
      oracleWallets,
    });

    const claimIds = [
      settledClaimId,
      failedClaimId,
      duplicateClaim.claimId,
      appealedClaimId,
    ];
    console.log("");
    console.log("Demo scenario populated successfully.");
    console.log("Demo user wallet:", userWallet.address);
    console.log("Auditor wallets:", auditorWallet.address, auditor2Wallet.address);

    for (const claimId of claimIds) {
      const claim = await adminContract.getClaim(claimId);
      console.log(`Claim #${claimId}: ${toClaimStatusName(claim)}`);
    }

    console.log("");
    console.log("Useful pages:");
    console.log(`- /auditor/claims/${settledClaimId}/history`);
    console.log(`- /auditor/claims/${failedClaimId}/history`);
    console.log(`- /auditor/vote/${duplicateClaim.claimId}`);
    console.log("- /admin/healthcare-registry");
    console.log("- /admin/thesis-dashboard");
  } finally {
    await mongoose.connection.close();
  }
}

main().catch((error) => {
  console.error("Demo population failed:");
  console.error(error);
  process.exit(1);
});
