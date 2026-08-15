const { ethers } = require("ethers");
const {
  getAdminContract,
  getPolicyEconomics,
  getOracleCoordinator,
  getRegistrySnapshot,
  getReadOnlyContract,
} = require("../services/contractService");
const { buildReserveIntelligence } = require("../services/settlementIntelligenceService");
const {
  getActiveRoleMembers,
  getPolicyPackageIds,
  paginate,
  parsePagination,
} = require("../services/contractQueryService");
const { buildRegistryMerkleRoot } = require("../services/merkleRegistryService");
const { notifyClaimStatusChange } = require("../services/notificationService");
const { logAdminAction } = require("../services/adminActionLogService");
const AdminActionLog = require("../models/AdminActionLog");
const User = require("../models/User");

const CONFIRMABLE_ADMIN_ACTIONS = {
  REQUEST_ORACLE_VERIFICATION: {
    event: "OracleRequested",
    status: "ORACLE_PENDING",
  },
  SEND_CLAIM_TO_MANUAL_REVIEW: {
    event: "ClaimSentToManualReview",
    status: "MANUAL_REVIEW",
  },
  RESOLVE_ORACLE_TIMEOUT: { event: "OracleTimedOut", status: "ORACLE_FAILED" },
};

/* ----------------------------- Status Map ------------------------------ */

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

/* ----------------------------- Utilities ------------------------------- */

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const formatTimestamp = (timestamp) => {
  const value = Number(timestamp);

  if (!value) {
    return null;
  }

  return {
    unix: value.toString(),
    iso: new Date(value * 1000).toISOString(),
  };
};

const formatClaim = (claim) => {
  const statusNumber = Number(claim.status);

  return {
    claimId: claim.claimId.toString(),
    policyId: claim.policyId.toString(),
    claimantWallet: claim.claimantWallet,
    claimAmountWei: claim.claimAmount.toString(),
    claimAmountEth: ethers.formatEther(claim.claimAmount),
    incidentDate: formatTimestamp(claim.incidentDate),
    claimType: claim.claimType,
    hospitalId: claim.hospitalId,
    invoiceHash: claim.invoiceHash,
    documentHash: claim.documentHash,
    documentCID: claim.documentCID,
    status: {
      code: statusNumber,
      label: CLAIM_STATUS[statusNumber] || "UNKNOWN",
    },
      verificationConfidence: claim.verificationConfidence.toString(),
    submittedAt: formatTimestamp(claim.submittedAt),
  };
};

const formatPolicyPackage = (policyPackage) => {
  return {
    packageId: policyPackage.packageId.toString(),
    name: policyPackage.name,
    policyType: policyPackage.policyType,
    premiumAmountWei: policyPackage.premiumAmount.toString(),
    premiumAmountEth: ethers.formatEther(policyPackage.premiumAmount),
    coverageAmountWei: policyPackage.coverageAmount.toString(),
    coverageAmountEth: ethers.formatEther(policyPackage.coverageAmount),
    durationDays: policyPackage.durationDays.toString(),
    requiredDocumentType: policyPackage.requiredDocumentType,
    isActive: policyPackage.isActive,
  };
};

const formatRegistrySnapshot = (snapshot) => {
  const root = snapshot.root || snapshot[0];
  const timestamp = snapshot.timestamp || snapshot[1];
  const blockNumber = snapshot.blockNumber || snapshot[2];
  const timestampValue = Number(timestamp);

  return {
    version: (snapshot.version || 0n).toString(),
    root,
    treeVersionHash: snapshot.treeVersionHash || ethers.ZeroHash,
    leafCount: (snapshot.leafCount || 0n).toString(),
    timestamp: {
      unix: timestamp.toString(),
      iso: timestampValue ? new Date(timestampValue * 1000).toISOString() : null,
    },
    blockNumber: blockNumber.toString(),
    committed: root !== ethers.ZeroHash && timestampValue > 0,
  };
};

const normalizeWallet = (wallet) => String(wallet || "").trim().toLowerCase();

const ROLE_KEYS = {
  ADMIN: "ADMIN_ROLE",
  AUDITOR: "AUDITOR_ROLE",
  ORACLE: "ORACLE_ROLE",
};

const asServiceCode = (value) =>
  ethers.keccak256(ethers.toUtf8Bytes(String(value || "").trim().toUpperCase()));

const publishEconomicRules = async ({ contract, packageId, economicRules }) => {
  const economics = await getPolicyEconomics(contract);
  const currentVersion = await economics.currentPackageRuleVersion(packageId);
  const allowedServices = (economicRules.allowedClaimTypes || []).map(asServiceCode);
  const excludedServices = (economicRules.excludedClaimTypes || []).map(asServiceCode);
  if (allowedServices.length === 0) {
    throw createError("At least one allowed claim type is required", 400);
  }
  const requiredDocuments = (economicRules.requiredDocumentTypes || []).map(asServiceCode);
  const exclusionsRoot = excludedServices.length
    ? ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32[]"], [excludedServices]))
    : ethers.ZeroHash;
  const requiredDocumentsRoot = requiredDocuments.length
    ? ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32[]"], [requiredDocuments]))
    : ethers.ZeroHash;
  const normalizedRules = {
    waitingPeriod: Number(economicRules.waitingPeriodDays || 0) * 86400,
    reinstatementWaitingPeriod:
      Number(economicRules.reinstatementWaitingPeriodDays || 0) * 86400,
    claimDeadline: Number(economicRules.claimDeadlineDays || 365) * 86400,
    minimumDocumentCommitments: Number(economicRules.minimumDocumentCommitments || 1),
    deductibleRateBps: Number(economicRules.deductibleRateBps || 0),
    insurerShareBps: Number(economicRules.insurerShareBps || 10000),
    deductibleCapWei: ethers.parseEther(String(economicRules.deductibleCapEth || "0")),
    maximumClaimWei: ethers.parseEther(String(economicRules.maximumClaimEth || "0")),
    exclusionsRoot,
    requiredDocumentsRoot,
  };
  const formulaName = economicRules.settlementFormulaVersion || "BLOCK_INSURE_SETTLEMENT_V1";
  const ruleDocument = JSON.stringify({
    packageId: String(packageId),
    version: (currentVersion + 1n).toString(),
    ...Object.fromEntries(
      Object.entries(normalizedRules).map(([key, value]) => [key, value.toString()])
    ),
    allowedServices,
    excludedServices,
    requiredDocuments,
  });
  const transaction = await economics.publishPackageRules(
    packageId,
    {
      version: currentVersion + 1n,
      ...normalizedRules,
      settlementFormulaVersion: ethers.keccak256(ethers.toUtf8Bytes(formulaName)),
      policyRuleVersion: ethers.keccak256(ethers.toUtf8Bytes(ruleDocument)),
    },
    allowedServices,
    excludedServices
  );
  const receipt = await transaction.wait();
  return { transaction, receipt, version: currentVersion + 1n, ruleDocument };
};

const getRoleBytes = async (contract, roleKey) => contract[ROLE_KEYS[roleKey]]();

const getConfiguredRoleWallets = () => {
  const wallets = [];
  const pushPrivateKeyWallet = (privateKey, role, label) => {
    try {
      if (privateKey) {
        wallets.push({
          walletAddress: normalizeWallet(new ethers.Wallet(privateKey).address),
          role,
          label,
        });
      }
    } catch (_) {
      // Invalid env values are reported elsewhere by the demo verifier.
    }
  };

  pushPrivateKeyWallet(process.env.ADMIN_PRIVATE_KEY, "ADMIN", "ADMIN_PRIVATE_KEY");
  pushPrivateKeyWallet(process.env.ORACLE_PRIVATE_KEY, "ORACLE", "ORACLE_PRIVATE_KEY");
  pushPrivateKeyWallet(process.env.ORACLE_PRIVATE_KEY_2, "ORACLE", "ORACLE_PRIVATE_KEY_2");

  return wallets;
};

/* -------------------------- Policy Package Admin ------------------------ */

const getAllPolicyPackages = async (req, res, next) => {
  try {
    const contract = getReadOnlyContract();
    const allPackageIds = await getPolicyPackageIds(contract);
    const { items: packageIds, pagination } = paginate(
      allPackageIds,
      parsePagination(req.query)
    );

    const packages = await Promise.all(
      packageIds.map(async (packageId) => {
        const policyPackage = await contract.getPolicyPackage(packageId);
        return formatPolicyPackage(policyPackage);
      })
    );

    res.status(200).json({
      success: true,
      count: packages.length,
      pagination,
      packages,
    });
  } catch (error) {
    next(error);
  }
};

const createPolicyPackage = async (req, res, next) => {
  try {
    const {
      name,
      policyType,
      premiumAmountEth,
      coverageAmountEth,
      durationDays,
      requiredDocumentType,
    } = req.body;

    if (
      !name ||
      !policyType ||
      !premiumAmountEth ||
      !coverageAmountEth ||
      !durationDays ||
      !requiredDocumentType
    ) {
      throw createError("All policy package fields are required", 400);
    }

    const premiumAmountWei = ethers.parseEther(premiumAmountEth.toString());
    const coverageAmountWei = ethers.parseEther(coverageAmountEth.toString());

    const contract = getAdminContract();

    const tx = await contract.createPolicyPackage(
      name,
      policyType,
      premiumAmountWei,
      coverageAmountWei,
      Number(durationDays),
      requiredDocumentType
    );

    const receipt = await tx.wait();

    let packageId = null;

    for (const log of receipt.logs) {
      try {
        const parsedLog = contract.interface.parseLog(log);

        if (parsedLog && parsedLog.name === "PolicyPackageCreated") {
          packageId = parsedLog.args.packageId.toString();
        }
      } catch (_) {
        // Ignore logs from other contracts.
      }
    }

    let economicsPublication = null;
    if (req.body.economicRules) {
      economicsPublication = await publishEconomicRules({
        contract,
        packageId,
        economicRules: req.body.economicRules,
      });
    }

    await logAdminAction({
      req,
      action: "CREATE_POLICY_PACKAGE",
      targetType: "POLICY_PACKAGE",
      targetId: packageId,
      tx,
      receipt,
      metadata: {
        name,
        policyType,
        premiumAmountWei: premiumAmountWei.toString(),
        coverageAmountWei: coverageAmountWei.toString(),
        durationDays: Number(durationDays),
        economicRuleVersion: economicsPublication?.version?.toString() || "0",
      },
    });

    res.status(201).json({
      success: true,
      message: "Policy package created successfully",
      packageId,
      transactionHash: tx.hash,
      package: {
        name,
        policyType,
        premiumAmountWei: premiumAmountWei.toString(),
        premiumAmountEth: premiumAmountEth.toString(),
        coverageAmountWei: coverageAmountWei.toString(),
        coverageAmountEth: coverageAmountEth.toString(),
        durationDays: Number(durationDays),
        requiredDocumentType,
      },
    });
  } catch (error) {
    next(error);
  }
};

const updatePolicyPackage = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      name,
      policyType,
      premiumAmountEth,
      coverageAmountEth,
      durationDays,
      requiredDocumentType,
    } = req.body;

    if (
      !id ||
      !name ||
      !policyType ||
      !premiumAmountEth ||
      !coverageAmountEth ||
      !durationDays ||
      !requiredDocumentType
    ) {
      throw createError("All policy package fields are required", 400);
    }

    const premiumAmountWei = ethers.parseEther(premiumAmountEth.toString());
    const coverageAmountWei = ethers.parseEther(coverageAmountEth.toString());
    const contract = getAdminContract();

    const tx = await contract.updatePolicyPackage(
      id,
      name,
      policyType,
      premiumAmountWei,
      coverageAmountWei,
      Number(durationDays),
      requiredDocumentType
    );

    const receipt = await tx.wait();

    const updatedPackage = await contract.getPolicyPackage(id);

    await logAdminAction({
      req,
      action: "UPDATE_POLICY_PACKAGE",
      targetType: "POLICY_PACKAGE",
      targetId: id,
      tx,
      receipt,
      metadata: {
        name,
        policyType,
        premiumAmountWei: premiumAmountWei.toString(),
        coverageAmountWei: coverageAmountWei.toString(),
        durationDays: Number(durationDays),
      },
    });

    res.status(200).json({
      success: true,
      message: "Policy package updated successfully",
      transactionHash: tx.hash,
      economicsTransactionHash:
        economicsPublication?.transaction?.hash || "",
      economicRuleVersion: economicsPublication?.version?.toString() || "0",
      package: formatPolicyPackage(updatedPackage),
    });
  } catch (error) {
    next(error);
  }
};

const publishPolicyPackageEconomicRules = async (req, res, next) => {
  try {
    const contract = getAdminContract();
    const result = await publishEconomicRules({
      contract,
      packageId: req.params.id,
      economicRules: req.body,
    });
    await logAdminAction({
      req,
      action: "PUBLISH_POLICY_ECONOMIC_RULES",
      targetType: "POLICY_PACKAGE",
      targetId: req.params.id,
      tx: result.transaction,
      receipt: result.receipt,
      metadata: {
        version: result.version.toString(),
        ruleDocument: result.ruleDocument,
      },
    });
    res.status(200).json({
      success: true,
      message: "Immutable policy economic rules published",
      version: result.version.toString(),
      transactionHash: result.transaction.hash,
    });
  } catch (error) {
    next(error);
  }
};

const deactivatePolicyPackage = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id) {
      throw createError("Package id is required", 400);
    }

    const contract = getAdminContract();
    const tx = await contract.deactivatePolicyPackage(id);

    const receipt = await tx.wait();

    const updatedPackage = await contract.getPolicyPackage(id);

    await logAdminAction({
      req,
      action: "DEACTIVATE_POLICY_PACKAGE",
      targetType: "POLICY_PACKAGE",
      targetId: id,
      tx,
      receipt,
    });

    res.status(200).json({
      success: true,
      message: "Policy package deactivated successfully",
      transactionHash: tx.hash,
      package: formatPolicyPackage(updatedPackage),
    });
  } catch (error) {
    next(error);
  }
};

const reactivatePolicyPackage = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id) {
      throw createError("Package id is required", 400);
    }

    const contract = getAdminContract();
    const tx = await contract.reactivatePolicyPackage(id);

    const receipt = await tx.wait();

    const updatedPackage = await contract.getPolicyPackage(id);

    await logAdminAction({
      req,
      action: "REACTIVATE_POLICY_PACKAGE",
      targetType: "POLICY_PACKAGE",
      targetId: id,
      tx,
      receipt,
    });

    res.status(200).json({
      success: true,
      message: "Policy package reactivated successfully",
      transactionHash: tx.hash,
      package: formatPolicyPackage(updatedPackage),
    });
  } catch (error) {
    next(error);
  }
};

/* ----------------------------- Claim Admin ------------------------------ */

const getReserveIntelligence = async (req, res, next) => {
  try {
    const reserveIntelligence = await buildReserveIntelligence();

    res.status(200).json({
      success: true,
      reserveIntelligence,
    });
  } catch (error) {
    next(error);
  }
};

const getRegistryMerkleRoot = async (req, res, next) => {
  try {
    const contract = getReadOnlyContract();
    const snapshot = await getRegistrySnapshot(contract);

    res.status(200).json({
      success: true,
      registrySnapshot: formatRegistrySnapshot(snapshot),
    });
  } catch (error) {
    next(error);
  }
};

const pushRegistryMerkleRoot = async (req, res, next) => {
  try {
    const merkleRoot = await buildRegistryMerkleRoot();
    const root = merkleRoot.rootHash || ethers.ZeroHash;
    const contract = getAdminContract();
    const coordinator = await getOracleCoordinator(contract);
    const treeVersionHash = ethers.keccak256(
      ethers.toUtf8Bytes(merkleRoot.treeVersion)
    );

    const tx = await coordinator.publishRegistrySnapshot(
      root,
      merkleRoot.leafCount,
      treeVersionHash
    );
    const receipt = await tx.wait();
    const snapshot = await getRegistrySnapshot(contract);

    await logAdminAction({
      req,
      action: "PUSH_REGISTRY_MERKLE_ROOT",
      targetType: "REGISTRY",
      targetId: root,
      tx,
      receipt,
      metadata: {
        root,
        leafCount: merkleRoot.leafCount,
        treeVersion: merkleRoot.treeVersion,
        treeVersionHash,
      },
    });

    res.status(200).json({
      success: true,
      message: "Registry Merkle root pushed on-chain successfully",
      root,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber,
      registrySnapshot: formatRegistrySnapshot(snapshot),
    });
  } catch (error) {
    next(error);
  }
};

const listAdminActionLogs = async (req, res, next) => {
  try {
    const {
      action,
      actorWallet,
      targetType,
      targetId,
      limit = 100,
      page = 1,
    } = req.query;
    const filter = {};

    if (action) filter.action = action;
    if (targetType) filter.targetType = targetType;
    if (targetId) filter.targetId = targetId;
    if (actorWallet) filter.actorWallet = actorWallet.toLowerCase();

    const pageSize = Math.min(Math.max(Number(limit) || 100, 1), 250);
    const currentPage = Math.max(Number(page) || 1, 1);
    const skip = (currentPage - 1) * pageSize;

    const [logs, total] = await Promise.all([
      AdminActionLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      AdminActionLog.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      count: logs.length,
      total,
      page: currentPage,
      limit: pageSize,
      logs,
    });
  } catch (error) {
    next(error);
  }
};

const getRoleSyncHealth = async (req, res, next) => {
  try {
    const contract = getReadOnlyContract();
    const users = await User.find({
      role: { $in: ["ADMIN", "AUDITOR", "ORACLE"] },
    })
      .select("walletAddress role name email")
      .lean();
    const roleBytes = {
      ADMIN: await getRoleBytes(contract, "ADMIN"),
      AUDITOR: await getRoleBytes(contract, "AUDITOR"),
      ORACLE: await getRoleBytes(contract, "ORACLE"),
    };

    const checks = await Promise.all(
      users.map(async (user) => {
        const backendRole = user.role;
        const wallet = normalizeWallet(user.walletAddress);
        const [hasExpectedRole, hasAdminRole, hasAuditorRole, hasOracleRole] =
          await Promise.all([
            contract.hasRole(roleBytes[backendRole], wallet),
            contract.hasRole(roleBytes.ADMIN, wallet),
            contract.hasRole(roleBytes.AUDITOR, wallet),
            contract.hasRole(roleBytes.ORACLE, wallet),
          ]);
        const onChainRoles = [
          hasAdminRole ? "ADMIN" : null,
          hasAuditorRole ? "AUDITOR" : null,
          hasOracleRole ? "ORACLE" : null,
        ].filter(Boolean);

        return {
          walletAddress: wallet,
          name: user.name || "",
          email: user.email || "",
          backendRole,
          onChainRoles,
          hasExpectedOnChainRole: Boolean(hasExpectedRole),
          healthy:
            Boolean(hasExpectedRole) &&
            onChainRoles.length === 1 &&
            onChainRoles[0] === backendRole,
          issues: [
            !hasExpectedRole
              ? `Backend ${backendRole} is missing ${ROLE_KEYS[backendRole]} on-chain`
              : null,
            onChainRoles.length > 0 && !onChainRoles.includes(backendRole)
              ? `Wallet has on-chain ${onChainRoles.join(", ")} but backend role is ${backendRole}`
              : null,
          ].filter(Boolean),
        };
      })
    );

    let trackedAuditors = [];

    try {
      trackedAuditors = (
        await getActiveRoleMembers(contract, roleBytes.AUDITOR)
      ).map(normalizeWallet);
    } catch (_) {
      trackedAuditors = [];
    }

    const backendRoleByWallet = new Map(
      users.map((user) => [normalizeWallet(user.walletAddress), user.role])
    );
    const orphanedAuditors = trackedAuditors
      .filter((wallet) => backendRoleByWallet.get(wallet) !== "AUDITOR")
      .map((wallet) => ({
        walletAddress: wallet,
        backendRole: backendRoleByWallet.get(wallet) || "MISSING",
        onChainRoles: ["AUDITOR"],
        healthy: false,
        issues: ["On-chain AUDITOR_ROLE tracked but backend role is missing or different"],
      }));
    const configuredRoleRows = await Promise.all(
      getConfiguredRoleWallets()
        .filter(
          (entry) =>
            entry.walletAddress && backendRoleByWallet.get(entry.walletAddress) !== entry.role
        )
        .map(async (entry) => ({
          walletAddress: entry.walletAddress,
          backendRole: backendRoleByWallet.get(entry.walletAddress) || "MISSING",
          onChainRoles: (await contract.hasRole(roleBytes[entry.role], entry.walletAddress))
            ? [entry.role]
            : [],
          healthy: false,
          issues: [
            `${entry.label} maps to ${entry.role}, but backend role is ${backendRoleByWallet.get(entry.walletAddress) || "missing"}`,
          ],
        }))
    );
    const rows = [...checks, ...orphanedAuditors, ...configuredRoleRows];
    const mismatches = rows.filter((row) => !row.healthy);

    res.status(200).json({
      success: true,
      generatedAt: new Date().toISOString(),
      summary: {
        checkedWallets: rows.length,
        mismatches: mismatches.length,
        healthy: mismatches.length === 0,
      },
      rows,
    });
  } catch (error) {
    next(error);
  }
};

const getAdminClaims = async (req, res, next) => {
  try {
    const contract = getReadOnlyContract();

    const nextClaimId = Number(await contract.claimCounter());
    const allClaimIds = Array.from(
      { length: Math.max(nextClaimId - 1, 0) },
      (_, index) => BigInt(index + 1)
    );
    const { items: claimIds, pagination } = paginate(
      allClaimIds,
      parsePagination(req.query)
    );
    const claims = await Promise.all(
      claimIds.map(async (claimId) =>
        formatClaim(await contract.getClaim(claimId))
      )
    );

    res.status(200).json({
      success: true,
      count: claims.length,
      pagination,
      claims,
    });
  } catch (error) {
    next(error);
  }
};

const requestOracleForClaim = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id) {
      throw createError("Claim id is required", 400);
    }

    const contract = getAdminContract();

    const tx = await contract.requestOracleVerification(id);
    const receipt = await tx.wait();

    let oracleRequest = null;

    for (const log of receipt.logs) {
      try {
        const parsedLog = contract.interface.parseLog(log);

        if (parsedLog && parsedLog.name === "OracleRequested") {
          oracleRequest = {
            requestId: parsedLog.args.requestId.toString(),
            claimId: parsedLog.args.claimId.toString(),
            oracleType: parsedLog.args.oracleType,
          };
        }
      } catch (_) {
        // Ignore logs from other contracts.
      }
    }

    const updatedClaim = await contract.getClaim(id);

    await notifyClaimStatusChange({
      claim: updatedClaim,
      status: "ORACLE_PENDING",
      transactionHash: tx.hash,
      source: "admin-request-oracle",
      message: `Oracle verification started for claim #${id}.`,
    });

    await logAdminAction({
      req,
      action: "REQUEST_ORACLE_VERIFICATION",
      targetType: "CLAIM",
      targetId: id,
      tx,
      receipt,
      metadata: { oracleRequest },
    });

    res.status(200).json({
      success: true,
      message: "Oracle verification requested successfully",
      transactionHash: tx.hash,
      oracleRequest,
      claim: formatClaim(updatedClaim),
    });
  } catch (error) {
    next(error);
  }
};

const resolveTimedOutOracle = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id) {
      throw createError("Claim id is required", 400);
    }

    const contract = getAdminContract();
    const coordinator = await getOracleCoordinator(contract);
    const tx = await coordinator.resolveTimedOutRequest(id);
    const receipt = await tx.wait();
    let timeoutEvent = null;

    for (const log of receipt.logs) {
      try {
        const parsedLog = contract.interface.parseLog(log);

        if (parsedLog && parsedLog.name === "OracleTimedOut") {
          timeoutEvent = {
            requestId: parsedLog.args.requestId.toString(),
            claimId: parsedLog.args.claimId.toString(),
            resolvedAtBlock: parsedLog.args.resolvedAtBlock.toString(),
          };
        }
      } catch (_) {
        // Ignore logs from other contracts.
      }
    }

    const updatedClaim = await contract.getClaim(id);

    await notifyClaimStatusChange({
      claim: updatedClaim,
      status: "ORACLE_FAILED",
      transactionHash: tx.hash,
      source: "oracle-timeout",
      message: `Oracle verification timed out for claim #${id}; the claim is ready for manual review.`,
    });

    await logAdminAction({
      req,
      action: "RESOLVE_ORACLE_TIMEOUT",
      targetType: "CLAIM",
      targetId: id,
      tx,
      receipt,
      metadata: { timeoutEvent },
    });

    res.status(200).json({
      success: true,
      message: "Timed-out oracle request resolved successfully",
      transactionHash: tx.hash,
      timeoutEvent,
      claim: formatClaim(updatedClaim),
    });
  } catch (error) {
    next(error);
  }
};

const sendClaimToManualReview = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id) {
      throw createError("Claim id is required", 400);
    }

    const contract = getAdminContract();

    const tx = await contract.sendToManualReview(id);
    const receipt = await tx.wait();

    let manualReviewEvent = null;

    for (const log of receipt.logs) {
      try {
        const parsedLog = contract.interface.parseLog(log);

        if (parsedLog && parsedLog.name === "ClaimSentToManualReview") {
          manualReviewEvent = {
            claimId: parsedLog.args.claimId.toString(),
            sentBy: parsedLog.args.sentBy,
            timestamp: parsedLog.args.timestamp
              ? parsedLog.args.timestamp.toString()
              : null,
          };
        }
      } catch (_) {
        // Ignore logs from other contracts.
      }
    }

    const updatedClaim = await contract.getClaim(id);

    await notifyClaimStatusChange({
      claim: updatedClaim,
      status: "MANUAL_REVIEW",
      transactionHash: tx.hash,
      source: "admin-manual-review",
      message: `Claim #${id} was sent to manual review.`,
    });

    await logAdminAction({
      req,
      action: "SEND_CLAIM_TO_MANUAL_REVIEW",
      targetType: "CLAIM",
      targetId: id,
      tx,
      receipt,
      metadata: { manualReviewEvent },
    });

    res.status(200).json({
      success: true,
      message: "Claim sent to manual review successfully",
      transactionHash: tx.hash,
      manualReviewEvent,
      claim: formatClaim(updatedClaim),
    });
  } catch (error) {
    next(error);
  }
};

const confirmAdminClaimTransaction = async (req, res, next) => {
  try {
    const claimId = String(req.params.id || "").trim();
    const action = String(req.body.action || "").trim().toUpperCase();
    const transactionHash = String(req.body.transactionHash || "").trim();
    const actionConfig = CONFIRMABLE_ADMIN_ACTIONS[action];

    if (!claimId || !/^\d+$/.test(claimId)) {
      throw createError("A valid claim id is required", 400);
    }

    if (!actionConfig) {
      throw createError("Unsupported admin claim action", 400);
    }

    if (!/^0x[a-f\d]{64}$/i.test(transactionHash)) {
      throw createError("A valid transactionHash is required", 400);
    }

    const previousConfirmation = await AdminActionLog.findOne({
      action,
      transactionHash,
    }).lean();

    if (previousConfirmation) {
      const contract = getReadOnlyContract();
      const claim = await contract.getClaim(claimId);

      return res.status(200).json({
        success: true,
        idempotent: true,
        message: "Admin transaction was already confirmed",
        transactionHash,
        claim: formatClaim(claim),
      });
    }

    const contract = getReadOnlyContract();
    const expectedTarget =
      action === "RESOLVE_ORACLE_TIMEOUT"
        ? await (await getOracleCoordinator(contract)).getAddress()
        : String(contract.target);
    const [receipt, transaction] = await Promise.all([
      contract.runner.getTransactionReceipt(transactionHash),
      contract.runner.getTransaction(transactionHash),
    ]);

    if (!receipt || !transaction) {
      return res.status(202).json({
        success: false,
        pending: true,
        message: "Admin transaction is still pending",
      });
    }

    if (Number(receipt.status) !== 1) {
      throw createError("Admin transaction reverted", 409);
    }

    if (
      transaction.to?.toLowerCase() !== expectedTarget.toLowerCase()
    ) {
      throw createError("Transaction does not target the expected contract", 409);
    }

    if (
      transaction.from.toLowerCase() !== req.user.walletAddress.toLowerCase()
    ) {
      throw createError(
        "Transaction signer does not match the authenticated admin wallet",
        403
      );
    }

    let confirmedEvent = null;

    for (const log of receipt.logs) {
      try {
        const parsedLog = contract.interface.parseLog(log);
        const eventClaimId = parsedLog?.args?.claimId?.toString();

        if (
          parsedLog?.name === actionConfig.event &&
          eventClaimId === claimId
        ) {
          confirmedEvent = {
            name: parsedLog.name,
            claimId: eventClaimId,
          };
          break;
        }
      } catch {
        // Ignore unrelated logs.
      }
    }

    if (!confirmedEvent) {
      throw createError(
        `Transaction does not contain ${actionConfig.event} for claim #${claimId}`,
        409
      );
    }

    const claim = await contract.getClaim(claimId);

    if (actionConfig.status) {
      await notifyClaimStatusChange({
        claim,
        status: actionConfig.status,
        transactionHash,
        source: `wallet-admin-${action.toLowerCase()}`,
        message: `Claim #${claimId} was updated by admin ${req.user.walletAddress}.`,
      });
    }

    await logAdminAction({
      req,
      action,
      targetType: "CLAIM",
      targetId: claimId,
      tx: { hash: transactionHash },
      receipt,
      metadata: {
        confirmedEvent,
        onChainActor: transaction.from,
        executionMode: "ADMIN_BROWSER_WALLET",
      },
    });

    res.status(200).json({
      success: true,
      message: "Admin wallet transaction confirmed and audited",
      transactionHash,
      onChainActor: transaction.from,
      claim: formatClaim(claim),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllPolicyPackages,
  createPolicyPackage,
  updatePolicyPackage,
  deactivatePolicyPackage,
  reactivatePolicyPackage,
  getReserveIntelligence,
  getRegistryMerkleRoot,
  pushRegistryMerkleRoot,
  listAdminActionLogs,
  getRoleSyncHealth,
  getAdminClaims,
  requestOracleForClaim,
  resolveTimedOutOracle,
  confirmAdminClaimTransaction,
  sendClaimToManualReview,
  publishPolicyPackageEconomicRules,
};
