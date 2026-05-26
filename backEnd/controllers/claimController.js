const { ethers } = require("ethers");
const { getReadOnlyContract } = require("../services/contractService");

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

const getClaimById = async (req, res, next) => {
  try {
    const contract = getReadOnlyContract();

    const claim = await contract.getClaim(req.params.claimId);
    const documents = await contract.getClaimDocuments(req.params.claimId);

    res.status(200).json({
      success: true,
      claim: formatClaim(claim),
      documents: documents.map(formatClaimDocument),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMyClaims,
  getClaimById,
};