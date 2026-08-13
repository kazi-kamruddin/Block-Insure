require("dotenv").config();

const dns = require("dns");
const mongoose = require("mongoose");
const { ethers } = require("ethers");
const InsuranceManagerArtifact = require("../abi/InsuranceManager.json");
const OracleCoordinatorArtifact = require("../abi/OracleCoordinator.json");
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
};

const CLAIM_STATUS = [
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

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is missing in backEnd/.env`);
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

  if (fallbackName === "auditor" || fallbackName === "auditor2") {
    return "";
  }

  return DEFAULT_LOCAL_KEYS[fallbackName] || ethers.Wallet.createRandom().privateKey;
}

function assertBuiltInDemoKeysAreLocal(rpcUrl) {
  const usesBuiltInUserKey =
    !process.env.DEMO_USER_PRIVATE_KEY &&
    process.env.DEMO_USE_HARDHAT_ACCOUNTS !== "false";

  if (!usesBuiltInUserKey) return;

  let hostname;
  try {
    hostname = new URL(rpcUrl).hostname.toLowerCase();
  } catch {
    throw new Error("RPC_URL must be a valid URL before demo keys can be used");
  }

  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (!localHosts.has(hostname)) {
    throw new Error(
      "Built-in Hardhat demo keys are restricted to a localhost RPC. Configure DEMO_USER_PRIVATE_KEY or set DEMO_USE_HARDHAT_ACCOUNTS=false."
    );
  }
}

function getWallet(privateKey, provider, label) {
  if (!privateKey) {
    throw new Error(`${label} private key is not configured`);
  }

  try {
    return new ethers.Wallet(privateKey, provider);
  } catch (error) {
    throw new Error(
      `${label} private key is invalid: ${error.shortMessage || error.message}`
    );
  }
}

function withNonceManager(wallet) {
  const signer = new ethers.NonceManager(wallet);

  // Keep the script's existing wallet.address usage working while routing all
  // transactions through one signer that increments nonces locally.
  signer.address = wallet.address;

  return signer;
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

async function assertContractDeployed(provider, contractAddress) {
  const code = await provider.getCode(contractAddress);

  if (!code || code === "0x") {
    throw new Error(
      [
        `No contract bytecode found at ${contractAddress}.`,
        "This usually means the Hardhat node was restarted after deployment,",
        "or backEnd/.env VITE_CONTRACT_ADDRESS was not updated with the latest deployed address.",
      ].join(" ")
    );
  }
}

async function fundWalletIfNeeded({ adminWallet, provider, wallet, label }) {
  const balance = await provider.getBalance(wallet.address);

  if (balance >= ethers.parseEther("1")) {
    return;
  }

  console.log(`Funding ${label} ${wallet.address} with 5 ETH...`);

  const tx = await adminWallet.sendTransaction({
    to: wallet.address,
    value: ethers.parseEther("5"),
  });

  await tx.wait();
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
  const coordinator = new ethers.Contract(
    await contract.oracleCoordinator(),
    OracleCoordinatorArtifact.abi,
    contract.runner
  );
  const [root, timestamp, blockNumber] = await Promise.all([
    coordinator.currentRegistryRoot(),
    coordinator.currentRegistryTimestamp(),
    coordinator.currentRegistryBlock(),
  ]);
  const snapshot = { root, timestamp, blockNumber };

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
  const coordinator = new ethers.Contract(
    await oracleContract.oracleCoordinator(),
    OracleCoordinatorArtifact.abi,
    oracleWallet
  );
  const request = await coordinator.getRequest(requestId);
  const verificationCode = oracleResponse.verified
    ? "VERIFIED"
    : "HOSPITAL_REJECTED";
  const resultHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      [
        "uint256", "uint256", "bytes32", "uint64", "uint64",
        "bytes32", "bytes32", "bool", "bytes32", "bytes32",
      ],
      [
        request.requestId,
        request.claimId,
        request.queryHash,
        request.claimVersion,
        request.registryVersion,
        request.registryRoot,
        request.modelVersion,
        oracleResponse.verified,
        ethers.keccak256(ethers.toUtf8Bytes(verificationCode)),
        hospitalVerification.merkleProof?.leafHash || ethers.ZeroHash,
      ]
    )
  );
  oracleResponse.resultHash = resultHash;
  const salt = ethers.keccak256(
    ethers.solidityPacked(
      ["string", "uint256", "address"],
      ["BLOCK_INSURE_DEMO_SALT", requestId, oracleWallet.address]
    )
  );
  const commitment = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint64", "uint64", "bool", "bytes32", "bytes32", "bytes32"],
      [requestId, request.claimVersion, request.registryVersion, oracleResponse.verified, resultHash, request.modelVersion, salt]
    )
  );
  const startedAt = Date.now();
  await waitFor(coordinator.commitOracleResult(requestId, commitment));

  return { coordinator, request, salt, oracleResponse, startedAt };
}

async function revealDemoOracle({ coordinator, request, salt, oracleResponse, startedAt }) {
  const receipt = await waitFor(
    coordinator.revealOracleResult(
      request.requestId,
      oracleResponse.verified,
      oracleResponse.resultHash,
      request.claimVersion,
      request.registryVersion,
      request.modelVersion,
      salt
    )
  );

  await OracleLog.create({
    requestId: requestId.toString(),
    claimId: claimId.toString(),
    oracleType,
    queryData: oracleResponse.queryData,
    responseData: oracleResponse,
    resultHash: oracleResponse.resultHash,
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
  const first = await submitOracleConfirmation({
    requestId,
    claimId,
    oracleWallet: oracleWallets[0],
    oracleInstanceId: "1",
    registrySnapshot: "primary",
    oracleType: "HOSPITAL",
    contractAddress,
    provider,
  });

  const second = await submitOracleConfirmation({
    requestId,
    claimId,
    oracleWallet: oracleWallets[1],
    oracleInstanceId: "2",
    registrySnapshot: "oracle2",
    oracleType: "HOSPITAL",
    contractAddress,
    provider,
  });

  await revealDemoOracle(first);
  await revealDemoOracle(second);

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
  assertBuiltInDemoKeysAreLocal(rpcUrl);
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
    process.env.DEMO_AUDITOR_PRIVATE_KEY ||
    "";
  const auditor2PrivateKey = process.env.DEMO_AUDITOR_PRIVATE_KEY_2 || "";
  const packageId = getArgValue("--package", process.env.DEMO_PACKAGE_ID || "1");

  await mongoose.connect(mongodbUri);

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const adminWallet = withNonceManager(
      getWallet(adminPrivateKey, provider, "Admin")
    );
    const userWallet = withNonceManager(
      getWallet(userPrivateKey, provider, "Demo user")
    );
    const oracleWallet = withNonceManager(
      getWallet(oraclePrivateKey, provider, "Oracle 1")
    );
    const oracle2Wallet = withNonceManager(
      getWallet(oracle2PrivateKey, provider, "Oracle 2")
    );
    const auditorWallet = auditorPrivateKey
      ? withNonceManager(getWallet(auditorPrivateKey, provider, "Auditor 1"))
      : null;
    const auditor2Wallet = auditor2PrivateKey
      ? withNonceManager(getWallet(auditor2PrivateKey, provider, "Auditor 2"))
      : null;
    const canAutoVote = Boolean(auditorWallet && auditor2Wallet);
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
    const auditorContract = auditorWallet
      ? new ethers.Contract(
          contractAddress,
          InsuranceManagerArtifact.abi,
          auditorWallet
        )
      : null;
    const auditor2Contract = auditor2Wallet
      ? new ethers.Contract(
          contractAddress,
          InsuranceManagerArtifact.abi,
          auditor2Wallet
        )
      : null;

    await assertContractDeployed(provider, contractAddress);

    await fundWalletIfNeeded({
      adminWallet,
      provider,
      wallet: userWallet,
      label: "demo user",
    });
    await fundWalletIfNeeded({
      adminWallet,
      provider,
      wallet: oracleWallet,
      label: "oracle 1",
    });
    await fundWalletIfNeeded({
      adminWallet,
      provider,
      wallet: oracle2Wallet,
      label: "oracle 2",
    });
    if (auditorWallet) {
      await fundWalletIfNeeded({
        adminWallet,
        provider,
        wallet: auditorWallet,
        label: "auditor 1",
      });
    }

    if (auditor2Wallet) {
      await fundWalletIfNeeded({
        adminWallet,
        provider,
        wallet: auditor2Wallet,
        label: "auditor 2",
      });
    }

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
    if (auditorWallet) {
      await grantRoleIfMissing(adminContract, auditorRole, auditorWallet.address, "AUDITOR_ROLE");
    }

    if (auditor2Wallet) {
      await grantRoleIfMissing(adminContract, auditorRole, auditor2Wallet.address, "AUDITOR_ROLE");
    }

    const contractBalance = await provider.getBalance(contractAddress);

    if (contractBalance < ethers.parseEther("1")) {
      console.log("Funding contract reserve with 3 ETH...");
      await waitFor(adminContract.fundContract({ value: ethers.parseEther("3") }));
    }

    const merkleRoot = await exportMerkleRoot();
    const coordinator = new ethers.Contract(
      await adminContract.oracleCoordinator(),
      OracleCoordinatorArtifact.abi,
      adminWallet
    );
    await waitFor(
      coordinator.publishRegistrySnapshot(
        merkleRoot,
        records.length,
        ethers.keccak256(ethers.toUtf8Bytes("phase-6-registry-merkle-v1"))
      )
    );
    console.log("Registry Merkle root pushed on-chain:", merkleRoot);

    const oracleWallets = [oracleWallet, oracle2Wallet];
    const selectedInvoiceNumbers = new Set();
    const takeRecord = (label, predicate) => {
      const record = records.find(
        (candidate) =>
          !selectedInvoiceNumbers.has(candidate.invoiceNumber) && predicate(candidate)
      );

      if (!record) {
        throw new Error(`No synthetic registry record found for ${label}`);
      }

      selectedInvoiceNumbers.add(record.invoiceNumber);
      return record;
    };

    const cleanRecord = (record) =>
      record.fraudLabel === "LEGITIMATE" &&
      record.invoiceNumber !== "INV-HOSP-001-001";
    const riskyRecord = (record) =>
      record.fraudLabel === "USED_INVOICE" ||
      record.fraudLabel === "CANCELLED_RECORD" ||
      record.fraudLabel === "BLACKLISTED_HOSPITAL" ||
      record.fraudLabel === "DATE_MISMATCH" ||
      record.fraudLabel === "SUSPICIOUS_PATTERN";

    const closedRecord = takeRecord("closed claim", cleanRecord);
    const settledOnlyRecord = takeRecord("settled claim", cleanRecord);
    const approvedRecord = takeRecord("approved claim", cleanRecord);
    const verifiedRecord = takeRecord("oracle-verified claim", cleanRecord);
    const rejectedRecord = takeRecord("rejected claim", riskyRecord);
    const duplicateCheckedRecord = takeRecord("duplicate-checked claim", cleanRecord);
    const pendingRecord = takeRecord("oracle-pending claim", cleanRecord);
    const failedRecord = takeRecord(
      "oracle-failed claim",
      (record) => record.fraudLabel === "USED_INVOICE"
    );
    const manualFailedRecord = takeRecord("manual-review oracle failure", riskyRecord);
    const openVoteRecord = takeRecord("interactive voting claim", riskyRecord);
    const appealRecord = takeRecord("appeal/reopen claim", riskyRecord);

    const claimIds = [];

    console.log("Creating claim #1 closed scenario...");
    const closedClaimId = await createClaimScenario({
      userContract,
      userWallet,
      record: closedRecord,
      packageId,
      label: "closed-claim",
    });
    claimIds.push(closedClaimId);
    await runOracleQuorum({
      adminContract,
      provider,
      contractAddress,
      claimId: closedClaimId,
      oracleWallets,
    });
    await waitFor(userContract.withdrawSettlement(closedClaimId));

    console.log("Creating claim #2 settled scenario...");
    const settledClaimId = await createClaimScenario({
      userContract,
      userWallet,
      record: settledOnlyRecord,
      packageId,
      label: "settled-claim",
    });
    claimIds.push(settledClaimId);
    await runOracleQuorum({
      adminContract,
      provider,
      contractAddress,
      claimId: settledClaimId,
      oracleWallets,
    });
    await waitFor(userContract.withdrawSettlement(settledClaimId));

    console.log("Creating claim #3 approved scenario...");
    const approvedClaimId = await createClaimScenario({
      userContract,
      userWallet,
      record: approvedRecord,
      packageId,
      label: "approved-claim",
    });
    claimIds.push(approvedClaimId);
    await runOracleQuorum({
      adminContract,
      provider,
      contractAddress,
      claimId: approvedClaimId,
      oracleWallets,
    });

    console.log("Creating claim #4 oracle-verified scenario...");
    const verifiedClaimId = await createClaimScenario({
      userContract,
      userWallet,
      record: verifiedRecord,
      packageId,
      label: "verified-claim",
    });
    claimIds.push(verifiedClaimId);
    await runOracleQuorum({
      adminContract,
      provider,
      contractAddress,
      claimId: verifiedClaimId,
      oracleWallets,
    });

    console.log("Creating claim #5 oracle-failed scenario...");
    const failedClaimId = await createClaimScenario({
      userContract,
      userWallet,
      record: failedRecord,
      packageId,
      label: "failed-claim",
    });
    claimIds.push(failedClaimId);
    await runOracleQuorum({
      adminContract,
      provider,
      contractAddress,
      claimId: failedClaimId,
      oracleWallets,
    });

    console.log("Creating claim #6 manual-review oracle failure scenario...");
    const manualFailedClaimId = await createClaimScenario({
      userContract,
      userWallet,
      record: manualFailedRecord,
      packageId,
      label: "manual-review-failed-claim",
    });
    claimIds.push(manualFailedClaimId);
    await runOracleQuorum({
      adminContract,
      provider,
      contractAddress,
      claimId: manualFailedClaimId,
      oracleWallets,
    });
    await waitFor(adminContract.sendToManualReview(manualFailedClaimId));

    console.log("Creating claim #7 manual-review duplicate scenario...");
    const duplicatePolicyId = await purchasePolicy(userContract, packageId);
    const duplicateClaim = await submitClaimFromRecord({
      contract: userContract,
      policyId: duplicatePolicyId,
      record: closedRecord,
      invoiceHash: closedRecord.invoiceHash,
      documentSeed: "duplicate-claim",
      cidSeed: "duplicate-claim",
    });
    claimIds.push(duplicateClaim.claimId);
    await createEvidenceDocument({
      claimId: duplicateClaim.claimId,
      wallet: userWallet,
      label: "duplicate-claim-extra-evidence",
      documentType: "SUPPORTING_DOCUMENT",
    });
    await waitFor(adminContract.sendToManualReview(duplicateClaim.claimId));

    if (canAutoVote) {
      await waitFor(auditorContract.castVote(duplicateClaim.claimId, 1));
      await waitFor(auditor2Contract.castVote(duplicateClaim.claimId, 2));
      console.log(`Claim #${duplicateClaim.claimId} has two of four demo votes and remains open.`);
    } else {
      console.log(
        `Claim #${duplicateClaim.claimId} left open in MANUAL_REVIEW for MetaMask auditor voting.`
      );
    }

    console.log("Creating claim #8 fraud-flagged duplicate scenario...");
    const fraudFlaggedPolicyId = await purchasePolicy(userContract, packageId);
    const fraudFlaggedClaim = await submitClaimFromRecord({
      contract: userContract,
      policyId: fraudFlaggedPolicyId,
      record: settledOnlyRecord,
      invoiceHash: settledOnlyRecord.invoiceHash,
      documentSeed: "fraud-flagged-duplicate-claim",
      cidSeed: "fraud-flagged-duplicate-claim",
    });
    claimIds.push(fraudFlaggedClaim.claimId);

    console.log("Creating claim #9 rejected scenario...");
    const rejectedClaimId = await createClaimScenario({
      userContract,
      userWallet,
      record: rejectedRecord,
      packageId,
      label: "rejected-claim",
    });
    claimIds.push(rejectedClaimId);
    await runOracleQuorum({
      adminContract,
      provider,
      contractAddress,
      claimId: rejectedClaimId,
      oracleWallets,
    });
    await waitFor(adminContract.sendToManualReview(rejectedClaimId));
    if (canAutoVote) {
      await waitFor(auditorContract.castVote(rejectedClaimId, 2));
      await waitFor(auditor2Contract.castVote(rejectedClaimId, 2));
    }

    console.log("Creating claim #10 duplicate-checked scenario...");
    const duplicateCheckedClaimId = await createClaimScenario({
      userContract,
      userWallet,
      record: duplicateCheckedRecord,
      packageId,
      label: "duplicate-checked-claim",
    });
    claimIds.push(duplicateCheckedClaimId);

    console.log("Creating claim #11 oracle-pending scenario...");
    const pendingClaimId = await createClaimScenario({
      userContract,
      userWallet,
      record: pendingRecord,
      packageId,
      label: "pending-claim",
    });
    claimIds.push(pendingClaimId);
    await requestOracle(adminContract, pendingClaimId);

    console.log("Creating claim #12 appeal/reopen scenario...");
    const appealedClaimId = await createClaimScenario({
      userContract,
      userWallet,
      record: appealRecord,
      packageId,
      label: "appealed-claim",
    });
    claimIds.push(appealedClaimId);
    await runOracleQuorum({
      adminContract,
      provider,
      contractAddress,
      claimId: appealedClaimId,
      oracleWallets,
    });
    await waitFor(adminContract.sendToManualReview(appealedClaimId));
    if (canAutoVote) {
      await waitFor(auditorContract.castVote(appealedClaimId, 2));
      await waitFor(auditor2Contract.castVote(appealedClaimId, 2));
      await waitFor(
        userContract.submitAppeal(
          appealedClaimId,
          calculateTextSHA256("demo appeal reason")
        )
      );
    }

    console.log(
      `Claim #${manualFailedClaimId} left open in MANUAL_REVIEW for MetaMask auditor voting.`
    );
    console.log("");
    console.log("Demo scenario populated successfully.");
    console.log("Demo user wallet:", userWallet.address);
    console.log(
      canAutoVote
        ? `Auto-vote auditor wallets: ${auditorWallet.address}, ${auditor2Wallet.address}`
        : "Auto-voting skipped. Use your MetaMask auditor accounts to cast votes."
    );

    for (const claimId of claimIds) {
      const claim = await adminContract.getClaim(claimId);
      console.log(`Claim #${claimId}: ${toClaimStatusName(claim)}`);
    }

    console.log("");
    console.log("Useful pages:");
    console.log(`- /auditor/claims/${closedClaimId}/history`);
    console.log(`- /auditor/claims/${failedClaimId}/history`);
    console.log(`- /auditor/vote/${manualFailedClaimId}`);
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
