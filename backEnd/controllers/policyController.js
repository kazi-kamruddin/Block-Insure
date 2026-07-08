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

const POLICY_STATUS = [
  "PENDING_PAYMENT",
  "ACTIVE",
  "GRACE_PERIOD",
  "LAPSED",
  "CANCELLED",
  "EXPIRED",
  "RENEWED",
];

const formatPolicyStatus = (statusValue) => {
  const code = Number(statusValue);

  return {
    code,
    label: POLICY_STATUS[code] || "UNKNOWN",
  };
};

const formatPolicy = (policy, effectiveStatus = policy.status) => {
  const premiumAmount = policy.premiumAmount || 0n;
  const totalPremiumPaid = policy.totalPremiumPaid || policy.premiumPaid || 0n;

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
    isActive: formatPolicyStatus(effectiveStatus).label === "ACTIVE",
    status: formatPolicyStatus(effectiveStatus),
    premiumAmountWei: premiumAmount.toString(),
    premiumAmountEth: ethers.formatEther(premiumAmount),
    premiumInterval: policy.premiumInterval?.toString?.() || "0",
    nextPremiumDueDate: policy.nextPremiumDueDate?.toString?.() || "0",
    gracePeriodEnd: policy.gracePeriodEnd?.toString?.() || "0",
    lastPaidTimestamp: policy.lastPaidTimestamp?.toString?.() || "0",
    totalPremiumPaidWei: totalPremiumPaid.toString(),
    totalPremiumPaidEth: ethers.formatEther(totalPremiumPaid),
    installmentsPaid: policy.installmentsPaid?.toString?.() || "0",
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
        const [policy, effectiveStatus] = await Promise.all([
          contract.getPolicy(policyId),
          contract.getEffectivePolicyStatus(policyId),
        ]);
        return formatPolicy(policy, effectiveStatus);
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

    const [policy, effectiveStatus] = await Promise.all([
      contract.getPolicy(req.params.policyId),
      contract.getEffectivePolicyStatus(req.params.policyId),
    ]);

    if (!canReadPolicy(req, policy)) {
      return res.status(403).json({
        success: false,
        message: "Access denied: policy does not belong to this wallet",
      });
    }

    res.status(200).json({
      success: true,
      policy: formatPolicy(policy, effectiveStatus),
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
