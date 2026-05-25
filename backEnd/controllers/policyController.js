const { ethers } = require("ethers");
const { getReadOnlyContract } = require("../services/contractService");

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

module.exports = {
  getActivePolicyPackages,
};