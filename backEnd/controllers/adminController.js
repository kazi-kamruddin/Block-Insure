const { ethers } = require("ethers");
const {
  getAdminContract,
  getReadOnlyContract,
} = require("../services/contractService");
const { buildReserveIntelligence } = require("../services/settlementIntelligenceService");
const { exportMerkleRoot } = require("../services/merkleRegistryService");
const { notifyClaimStatusChange } = require("../services/notificationService");

/* ----------------------------- Status Map ------------------------------ */

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
    riskScore: claim.riskScore.toString(),
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

const formatContractBalance = async (contract) => {
  const balance = await contract.getContractBalance();

  return {
    wei: balance.toString(),
    eth: ethers.formatEther(balance),
  };
};

const formatRegistrySnapshot = (snapshot) => {
  const root = snapshot.root || snapshot[0];
  const timestamp = snapshot.timestamp || snapshot[1];
  const blockNumber = snapshot.blockNumber || snapshot[2];
  const timestampValue = Number(timestamp);

  return {
    root,
    timestamp: {
      unix: timestamp.toString(),
      iso: timestampValue ? new Date(timestampValue * 1000).toISOString() : null,
    },
    blockNumber: blockNumber.toString(),
    committed: root !== ethers.ZeroHash && timestampValue > 0,
  };
};

/* -------------------------- Policy Package Admin ------------------------ */

const getAllPolicyPackages = async (req, res, next) => {
  try {
    const contract = getReadOnlyContract();
    const packageIds = await contract.getAllPackageIds();

    const packages = await Promise.all(
      packageIds.map(async (packageId) => {
        const policyPackage = await contract.getPolicyPackage(packageId);
        return formatPolicyPackage(policyPackage);
      })
    );

    res.status(200).json({
      success: true,
      count: packages.length,
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

    await tx.wait();

    const updatedPackage = await contract.getPolicyPackage(id);

    res.status(200).json({
      success: true,
      message: "Policy package updated successfully",
      transactionHash: tx.hash,
      package: formatPolicyPackage(updatedPackage),
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

    await tx.wait();

    const updatedPackage = await contract.getPolicyPackage(id);

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

    await tx.wait();

    const updatedPackage = await contract.getPolicyPackage(id);

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
    const snapshot = await contract.getRegistrySnapshot();

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
    const root = await exportMerkleRoot();
    const contract = getAdminContract();

    const tx = await contract.updateRegistryMerkleRoot(root);
    const receipt = await tx.wait();
    const snapshot = await contract.getRegistrySnapshot();

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

const getAdminClaims = async (req, res, next) => {
  try {
    const contract = getReadOnlyContract();

    const nextClaimId = await contract.claimCounter();
    const totalCreatedClaims = Number(nextClaimId) - 1;

    const claims = [];

    for (let claimId = 1; claimId <= totalCreatedClaims; claimId += 1) {
      const claim = await contract.getClaim(claimId);
      claims.push(formatClaim(claim));
    }

    res.status(200).json({
      success: true,
      count: claims.length,
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

const approveClaim = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id) {
      throw createError("Claim id is required", 400);
    }

    const contract = getAdminContract();

    const tx = await contract.approveClaim(id);
    const receipt = await tx.wait();

    let approvalEvent = null;

    for (const log of receipt.logs) {
      try {
        const parsedLog = contract.interface.parseLog(log);

        if (parsedLog && parsedLog.name === "ClaimApproved") {
          approvalEvent = {
            claimId: parsedLog.args.claimId.toString(),
            approvedBy: parsedLog.args.approvedBy,
            timestamp: parsedLog.args.timestamp.toString(),
          };
        }
      } catch (_) {
        // Ignore logs from other contracts.
      }
    }

    const updatedClaim = await contract.getClaim(id);

    await notifyClaimStatusChange({
      claim: updatedClaim,
      status: "APPROVED",
      transactionHash: tx.hash,
      source: "admin-approve",
      message: `Claim #${id} was approved and is ready for settlement.`,
    });

    res.status(200).json({
      success: true,
      message: "Claim approved successfully",
      transactionHash: tx.hash,
      approvalEvent,
      claim: formatClaim(updatedClaim),
    });
  } catch (error) {
    next(error);
  }
};

const settleClaim = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id) {
      throw createError("Claim id is required", 400);
    }

    const contract = getAdminContract();

    const balanceBefore = await formatContractBalance(contract);

    const tx = await contract.settleClaim(id);
    const receipt = await tx.wait();

    let settlementEvent = null;
    let settlementCalculation = null;

    for (const log of receipt.logs) {
      try {
        const parsedLog = contract.interface.parseLog(log);

        if (parsedLog && parsedLog.name === "SettlementCalculated") {
          settlementCalculation = {
            claimId: parsedLog.args.claimId.toString(),
            claimAmountWei: parsedLog.args.claimAmount.toString(),
            claimAmountEth: ethers.formatEther(parsedLog.args.claimAmount),
            deductibleWei: parsedLog.args.deductible.toString(),
            deductibleEth: ethers.formatEther(parsedLog.args.deductible),
            insurerPaysWei: parsedLog.args.insurerPays.toString(),
            insurerPaysEth: ethers.formatEther(parsedLog.args.insurerPays),
            claimantResponsibilityWei:
              parsedLog.args.claimantResponsibility.toString(),
            claimantResponsibilityEth: ethers.formatEther(
              parsedLog.args.claimantResponsibility
            ),
          };
        }

        if (parsedLog && parsedLog.name === "ClaimSettled") {
          settlementEvent = {
            claimId: parsedLog.args.claimId.toString(),
            claimantWallet:
              parsedLog.args.claimantWallet ||
              parsedLog.args.recipient ||
              parsedLog.args[1],
            amountWei: parsedLog.args.amount.toString(),
            amountEth: ethers.formatEther(parsedLog.args.amount),
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
    const balanceAfter = await formatContractBalance(contract);

    await notifyClaimStatusChange({
      claim: updatedClaim,
      status: "SETTLED",
      transactionHash: tx.hash,
      source: "admin-settle",
      message: `Claim #${id} was settled successfully.`,
    });

    res.status(200).json({
      success: true,
      message: "Claim settled successfully",
      transactionHash: tx.hash,
      settlementEvent,
      settlementCalculation,
      contractBalance: {
        before: balanceBefore,
        after: balanceAfter,
      },
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
    const tx = await contract.resolveTimedOutOracle(id);
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

const closeClaim = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id) {
      throw createError("Claim id is required", 400);
    }

    const contract = getAdminContract();
    const tx = await contract.closeClaim(id);
    const receipt = await tx.wait();
    let closureEvent = null;

    for (const log of receipt.logs) {
      try {
        const parsedLog = contract.interface.parseLog(log);

        if (parsedLog && parsedLog.name === "ClaimClosed") {
          closureEvent = {
            claimId: parsedLog.args.claimId.toString(),
            closedBy: parsedLog.args.closedBy,
            timestamp: parsedLog.args.timestamp.toString(),
          };
        }
      } catch (_) {
        // Ignore logs from other contracts.
      }
    }

    const updatedClaim = await contract.getClaim(id);

    await notifyClaimStatusChange({
      claim: updatedClaim,
      status: "CLOSED",
      transactionHash: tx.hash,
      source: "admin-close",
      message: `Claim #${id} lifecycle was closed.`,
    });

    res.status(200).json({
      success: true,
      message: "Claim closed successfully",
      transactionHash: tx.hash,
      closureEvent,
      claim: formatClaim(updatedClaim),
    });
  } catch (error) {
    next(error);
  }
};

const rejectClaim = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason = "Claim rejected by admin" } = req.body;

    if (!id) {
      throw createError("Claim id is required", 400);
    }

    const contract = getAdminContract();

    const reasonHash = ethers.keccak256(ethers.toUtf8Bytes(reason));

    const tx = await contract.rejectClaim(id, reasonHash);
    const receipt = await tx.wait();

    let rejectionEvent = null;

    for (const log of receipt.logs) {
      try {
        const parsedLog = contract.interface.parseLog(log);

        if (parsedLog && parsedLog.name === "ClaimRejected") {
          rejectionEvent = {
            claimId: parsedLog.args.claimId.toString(),
            rejectedBy: parsedLog.args.rejectedBy,
            reasonHash: parsedLog.args.reasonHash,
          };
        }
      } catch (_) {
        // Ignore logs from other contracts.
      }
    }

    const updatedClaim = await contract.getClaim(id);

    await notifyClaimStatusChange({
      claim: updatedClaim,
      status: "REJECTED",
      transactionHash: tx.hash,
      source: "admin-reject",
      message: `Claim #${id} was rejected. You may submit one appeal.`,
    });

    res.status(200).json({
      success: true,
      message: "Claim rejected successfully",
      transactionHash: tx.hash,
      rejectionEvent,
      rejectionReason: reason,
      reasonHash,
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

module.exports = {
  getAllPolicyPackages,
  createPolicyPackage,
  updatePolicyPackage,
  deactivatePolicyPackage,
  reactivatePolicyPackage,
  getReserveIntelligence,
  getRegistryMerkleRoot,
  pushRegistryMerkleRoot,
  getAdminClaims,
  requestOracleForClaim,
  resolveTimedOutOracle,
  approveClaim,
  rejectClaim,
  settleClaim,
  closeClaim,
  sendClaimToManualReview,
};
