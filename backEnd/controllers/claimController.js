const { ethers } = require("ethers");
const { getReadOnlyContract } = require("../services/contractService");
const { getEvidenceChainForClaim } = require("../services/evidenceChainService");
const ClaimSubmissionAttempt = require("../models/ClaimSubmissionAttempt");

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

const POLICY_STATUS = [
  "PENDING_PAYMENT",
  "ACTIVE",
  "GRACE_PERIOD",
  "LAPSED",
  "CANCELLED",
  "EXPIRED",
  "RENEWED",
];

const canReadClaim = (req, claim) => {
  if (req.user.role === "ADMIN" || req.user.role === "AUDITOR") {
    return true;
  }

  return claim.claimantWallet.toLowerCase() === req.user.walletAddress.toLowerCase();
};

const canVerifyDocumentHash = (req) => {
  return req.user.role === "ADMIN" || req.user.role === "AUDITOR";
};

/* ---------------------- Format Contract Responses ---------------------- */

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

const formatClaimDocument = (document) => {
  return {
    documentHash: document.documentHash,
    documentCID: document.documentCID,
    uploadedAt: formatTimestamp(document.uploadedAt),
    documentType: document.documentType,
  };
};

/* ----------------------------- Controllers ----------------------------- */

const getMyClaims = async (req, res, next) => {
  try {
    const contract = getReadOnlyContract();

    const claimIds = await contract.getClaimsByWallet(req.user.walletAddress);

    const claims = await Promise.all(
      claimIds.map(async (claimId) => {
        const claim = await contract.getClaim(claimId);
        return formatClaim(claim);
      })
    );

    res.status(200).json({
      success: true,
      count: claims.length,
      claims,
    });
  } catch (error) {
    next(error);
  }
};

const getReadableClaims = async (req, res, next) => {
  try {
    if (req.user.role !== "ADMIN" && req.user.role !== "AUDITOR") {
      return res.status(403).json({
        success: false,
        message: "Access denied: admin or auditor role is required",
      });
    }

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

const getClaimById = async (req, res, next) => {
  try {
    const contract = getReadOnlyContract();

    const claim = await contract.getClaim(req.params.claimId);

    if (!canReadClaim(req, claim)) {
      return res.status(403).json({
        success: false,
        message: "Access denied: claim does not belong to this wallet",
      });
    }

    const documents = await contract.getClaimDocuments(req.params.claimId);
    const evidenceChain = await getEvidenceChainForClaim(req.params.claimId);

    res.status(200).json({
      success: true,
      claim: formatClaim(claim),
      documents: documents.map(formatClaimDocument),
      evidenceChain,
    });
  } catch (error) {
    next(error);
  }
};

const getClaimDocumentHash = async (req, res, next) => {
  try {
    if (!canVerifyDocumentHash(req)) {
      return res.status(403).json({
        success: false,
        message: "Access denied: auditor or admin role is required",
      });
    }

    const contract = getReadOnlyContract();
    const claimId = BigInt(req.params.claimId);
    const claim = await contract.getClaim(claimId);

    let blockNumber = null;

    try {
      const filter = contract.filters.ClaimSubmitted(claimId);
      const logs = await contract.queryFilter(filter, 0, "latest");
      blockNumber = logs[0]?.blockNumber ?? null;
    } catch (eventError) {
      console.warn(
        "Could not resolve claim document commit block:",
        eventError.message
      );
    }

    res.status(200).json({
      success: true,
      claimId: claim.claimId.toString(),
      claimantWallet: claim.claimantWallet,
      documentHash: claim.documentHash,
      documentCID: claim.documentCID,
      submittedAt: formatTimestamp(claim.submittedAt),
      blockNumber,
    });
  } catch (error) {
    next(error);
  }
};

const authorizeClaimSubmission = async (req, res, next) => {
  try {
    const policyId = String(req.body.policyId || "").trim();

    if (!/^\d+$/.test(policyId) || BigInt(policyId) === 0n) {
      return res.status(400).json({
        success: false,
        message: "policyId must be a positive integer",
      });
    }

    const contract = getReadOnlyContract();
    const [policy, effectiveStatus] = await Promise.all([
      contract.getPolicy(policyId),
      contract.getEffectivePolicyStatus(policyId),
    ]);

    if (policy.holderWallet.toLowerCase() !== req.user.walletAddress.toLowerCase()) {
      return res.status(403).json({
        success: false,
        message: "Access denied: policy does not belong to this wallet",
      });
    }

    const statusCode = Number(effectiveStatus);
    const statusLabel = POLICY_STATUS[statusCode] || "UNKNOWN";

    if (statusLabel !== "ACTIVE") {
      return res.status(409).json({
        success: false,
        message:
          statusLabel === "GRACE_PERIOD" || statusLabel === "LAPSED"
            ? "Policy premium is overdue and cannot submit claims"
            : `Policy is not active (${statusLabel})`,
        policyStatus: { code: statusCode, label: statusLabel },
      });
    }

    const maximumPerDay = Number(process.env.CLAIMS_PER_WALLET_24H || 3);
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentAttempts = await ClaimSubmissionAttempt.countDocuments({
      walletAddress: req.user.walletAddress,
      createdAt: { $gte: windowStart },
    });

    if (recentAttempts >= maximumPerDay) {
      return res.status(429).json({
        success: false,
        message: `Wallet claim submission limit reached (${maximumPerDay} per 24 hours).`,
      });
    }

    const attempt = await ClaimSubmissionAttempt.create({
      walletAddress: req.user.walletAddress,
      policyId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    res.status(200).json({
      success: true,
      message: "Claim submission authorized",
      attemptId: attempt._id,
      remainingToday: Math.max(maximumPerDay - recentAttempts - 1, 0),
      policyStatus: { code: statusCode, label: statusLabel },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  authorizeClaimSubmission,
  getReadableClaims,
  getMyClaims,
  getClaimById,
  getClaimDocumentHash,
};
