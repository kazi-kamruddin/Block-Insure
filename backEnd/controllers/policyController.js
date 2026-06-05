const { ethers } = require("ethers");
const { getReadOnlyContract } = require("../services/contractService");

/* ---------------------- Format Contract Responses ---------------------- */

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

const formatPolicy = (policy) => {
  return {
    policyId: policy.policyId.toString(),
    packageId: policy.packageId.toString(),
    holderWallet: policy.holderWallet,
    startDate: policy.startDate.toString(),
    endDate: policy.endDate.toString(),
    coverageAmountWei: policy.coverageAmount.toString(),
    coverageAmountEth: ethers.formatEther(policy.coverageAmount),
    premiumPaidWei: policy.premiumPaid.toString(),
    premiumPaidEth: ethers.formatEther(policy.premiumPaid),
    isActive: policy.isActive,
  };
};

const canReadPolicy = (req, policy) => {
  if (req.user.role === "ADMIN" || req.user.role === "AUDITOR") {
    return true;
  }

  return policy.holderWallet.toLowerCase() === req.user.walletAddress.toLowerCase();
};

/* -------------------------- Policy Packages ---------------------------- */

const getActivePolicyPackages = async (req, res, next) => {
  try {
    const contract = getReadOnlyContract();

    const packageIds = await contract.getActivePackageIds();

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

/* -------------------------- Purchased Policies -------------------------- */

const getMyPolicies = async (req, res, next) => {
  try {
    const contract = getReadOnlyContract();

    const policyIds = await contract.getPoliciesByWallet(req.user.walletAddress);

    const policies = await Promise.all(
      policyIds.map(async (policyId) => {
        const policy = await contract.getPolicy(policyId);
        return formatPolicy(policy);
      })
    );

    res.status(200).json({
      success: true,
      count: policies.length,
      policies,
    });
  } catch (error) {
    next(error);
  }
};

const getPolicyById = async (req, res, next) => {
  try {
    const contract = getReadOnlyContract();

    const policy = await contract.getPolicy(req.params.policyId);

    if (!canReadPolicy(req, policy)) {
      return res.status(403).json({
        success: false,
        message: "Access denied: policy does not belong to this wallet",
      });
    }

    res.status(200).json({
      success: true,
      policy: formatPolicy(policy),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getActivePolicyPackages,
  getMyPolicies,
  getPolicyById,
};
