const { ethers } = require("ethers");
const {
  getPolicyEconomics,
  getReadOnlyContract,
} = require("../services/contractService");
const { quoteRiskAdjustedPremium } = require("../services/pricingService");
const {
  evaluatePolicyEligibility,
  getPolicyTerms,
  getRealisticClaimScenarios,
} = require("../services/policyRuleService");
const {
  getActivePolicyPackageIds,
  getPolicyIdsByWallet,
  paginate,
  parsePagination,
} = require("../services/contractQueryService");
const PolicyTermsAcceptance = require("../models/PolicyTermsAcceptance");
const { buildPolicyDocument } = require("../services/policyDocumentService");
const {
  formatTerms: formatBenefitTerms,
  getReadOnlyBenefitsContract,
} = require("../services/policyBenefitsService");

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
    policyTerms: getPolicyTerms(policyPackage),
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

const loadPublicPolicyPackage = async (contract, packageId) => {
  const formattedPackage = formatPolicyPackage(
    await contract.getPolicyPackage(packageId)
  );
  let benefitTerms = null;

  try {
    benefitTerms = formatBenefitTerms(
      await getReadOnlyBenefitsContract().getBenefitTerms(packageId)
    );
  } catch {
    // A policy document remains available when the optional benefits deployment
    // has not yet been configured.
  }

  const document = buildPolicyDocument({
    policyPackage: formattedPackage,
    benefitTerms,
  });

  return {
    ...formattedPackage,
    benefitTerms,
    policyDocument: {
      documentVersion: document.documentVersion,
      documentHash: document.documentHash,
      benefitVersion: document.benefitVersion,
      downloadPath: `/api/policy-packages/${formattedPackage.packageId}/document?download=1`,
    },
    document,
  };
};

const formatPolicy = (
  policy,
  effectiveStatus = policy.status,
  policyPackage = null
) => {
  const premiumAmount = policy.premiumAmount || 0n;
  const totalPremiumPaid = policy.totalPremiumPaid || policy.premiumPaid || 0n;

  return {
    policyId: policy.policyId.toString(),
    packageId: policy.packageId.toString(),
    packageName: policyPackage?.name || "",
    policyType: policyPackage?.policyType || "",
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
    policyTerms: policyPackage ? getPolicyTerms(policyPackage) : null,
  };
};

const resolveClaimAmountWei = (body) => {
  if (body.claimAmountWei !== undefined && body.claimAmountWei !== "") {
    return String(body.claimAmountWei);
  }

  if (body.claimAmountEth !== undefined && body.claimAmountEth !== "") {
    try {
      return ethers.parseEther(String(body.claimAmountEth)).toString();
    } catch {
      const error = new Error("claimAmountEth must be a valid non-negative amount");
      error.statusCode = 400;
      throw error;
    }
  }

  const error = new Error("claimAmountWei or claimAmountEth is required");
  error.statusCode = 400;
  throw error;
};

const buildEligibilityInput = ({
  policy,
  policyPackage,
  body = {},
  historical = false,
}) => {
  const startDate = historical ? body.policyStartDate : policy.startDate.toString();
  const durationSeconds = Number(policyPackage.durationDays) * 24 * 60 * 60;
  const parsedStart = /^\d+$/.test(String(startDate || ""))
    ? Number(startDate)
    : Math.floor(Date.parse(startDate) / 1000);

  return {
    terms: getPolicyTerms(policyPackage),
    policyStartDate: startDate,
    policyEndDate: historical
      ? body.policyEndDate || parsedStart + durationSeconds
      : policy.endDate.toString(),
    incidentDate: body.incidentDate,
    claimType: body.claimType,
    claimAmountWei: resolveClaimAmountWei(body),
    coverageAmountWei: historical
      ? body.coverageAmountWei || policyPackage.coverageAmount.toString()
      : policy.coverageAmount.toString(),
    preExistingCondition: body.preExistingCondition === true,
    disclosedAtPurchase: body.disclosedAtPurchase === true,
  };
};

const canReadPolicy = (req, policy) => {
  if (req.user.role === "ADMIN" || req.user.role === "AUDITOR") {
    return true;
  }

  return policy.holderWallet.toLowerCase() === req.user.walletAddress.toLowerCase();
};

const formatEconomicValue = (value) => {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(formatEconomicValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => Number.isNaN(Number(key)))
        .map(([key, child]) => [key, formatEconomicValue(child)])
    );
  }
  return value;
};

/* -------------------------- Policy Packages ---------------------------- */

const getActivePolicyPackages = async (req, res, next) => {
  try {
    const contract = getReadOnlyContract();

    const allPackageIds = await getActivePolicyPackageIds(contract);
    const { items: packageIds, pagination } = paginate(
      allPackageIds,
      parsePagination(req.query)
    );

    const packages = await Promise.all(
      packageIds.map(async (packageId) => {
        const loaded = await loadPublicPolicyPackage(contract, packageId);
        const { document, ...policyPackage } = loaded;
        return policyPackage;
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

const getPublicPolicyPackage = async (req, res, next) => {
  try {
    const contract = getReadOnlyContract();
    const loaded = await loadPublicPolicyPackage(contract, req.params.packageId);

    if (!loaded.isActive) {
      return res.status(404).json({
        success: false,
        message: "This policy package is not publicly available",
      });
    }

    const { document, ...publicPackage } = loaded;
    res.status(200).json({
      success: true,
      policyPackage: {
        ...publicPackage,
        policyDocument: {
          ...loaded.policyDocument,
          content: document.markdown,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

const downloadPublicPolicyDocument = async (req, res, next) => {
  try {
    const contract = getReadOnlyContract();
    const loaded = await loadPublicPolicyPackage(contract, req.params.packageId);

    if (!loaded.isActive) {
      return res.status(404).send("Policy package is not publicly available");
    }

    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `${req.query.download === "1" ? "attachment" : "inline"}; filename="policy-package-${loaded.packageId}-terms.md"`
    );
    res.status(200).send(loaded.document.markdown);
  } catch (error) {
    next(error);
  }
};

const acceptPublicPolicyTerms = async (req, res, next) => {
  try {
    const contract = getReadOnlyContract();
    const loaded = await loadPublicPolicyPackage(contract, req.params.packageId);
    const suppliedVersion = String(req.body.documentVersion || "").trim();
    const suppliedHash = String(req.body.documentHash || "").trim().toLowerCase();

    if (!loaded.isActive) {
      return res.status(409).json({
        success: false,
        message: "This policy package is no longer available for purchase",
      });
    }

    if (
      suppliedVersion !== loaded.document.documentVersion ||
      suppliedHash !== loaded.document.documentHash.toLowerCase()
    ) {
      return res.status(409).json({
        success: false,
        message: "Policy terms changed. Review and accept the latest document before purchasing.",
        latestDocument: loaded.policyDocument,
      });
    }

    const acceptance = await PolicyTermsAcceptance.findOneAndUpdate(
      {
        walletAddress: req.user.walletAddress.toLowerCase(),
        packageId: loaded.packageId,
        documentHash: loaded.document.documentHash.toLowerCase(),
      },
      {
        $setOnInsert: {
          documentVersion: loaded.document.documentVersion,
          acceptedAt: new Date(),
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({
      success: true,
      acceptance: {
        packageId: acceptance.packageId,
        walletAddress: acceptance.walletAddress,
        documentVersion: acceptance.documentVersion,
        documentHash: acceptance.documentHash,
        acceptedAt: acceptance.acceptedAt.toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
};

const getRiskPremiumQuote = async (req, res, next) => {
  try {
    const contract = getReadOnlyContract();
    const policyPackage = await contract.getPolicyPackage(req.params.packageId);
    const quote = quoteRiskAdjustedPremium({
      ...req.body,
      basePremiumWei: policyPackage.premiumAmount,
    });

    res.status(200).json({
      success: true,
      package: formatPolicyPackage(policyPackage),
      quote: {
        ...quote,
        basePremiumEth: ethers.formatEther(quote.basePremiumWei),
        finalPremiumEth: ethers.formatEther(quote.finalPremiumWei),
      },
    });
  } catch (error) {
    next(error);
  }
};

const getPolicyRuleCatalog = async (req, res, next) => {
  try {
    const contract = getReadOnlyContract();
    const packageIds = await getActivePolicyPackageIds(contract);
    const packages = await Promise.all(
      packageIds.map(async (packageId) =>
        formatPolicyPackage(await contract.getPolicyPackage(packageId))
      )
    );

    res.status(200).json({
      success: true,
      notice:
        "Policy profiles are an explainable thesis layer; issued on-chain terms remain authoritative.",
      packages,
    });
  } catch (error) {
    next(error);
  }
};

const getRealisticScenarios = (req, res) => {
  res.status(200).json({
    success: true,
    synthetic: true,
    scenarios: getRealisticClaimScenarios(),
  });
};

const simulateHistoricalPolicyEligibility = async (req, res, next) => {
  try {
    const contract = getReadOnlyContract();
    const policyPackage = await contract.getPolicyPackage(req.params.packageId);
    const evaluation = evaluatePolicyEligibility(
      buildEligibilityInput({
        policyPackage,
        body: req.body,
        historical: true,
      })
    );

    res.status(200).json({
      success: true,
      package: formatPolicyPackage(policyPackage),
      evaluation,
    });
  } catch (error) {
    next(error);
  }
};

/* -------------------------- Purchased Policies -------------------------- */

const getMyPolicies = async (req, res, next) => {
  try {
    const contract = getReadOnlyContract();

    const allPolicyIds = await getPolicyIdsByWallet(
      contract,
      req.user.walletAddress
    );
    const { items: policyIds, pagination } = paginate(
      allPolicyIds,
      parsePagination(req.query)
    );

    const policies = await Promise.all(
      policyIds.map(async (policyId) => {
        const [policy, effectiveStatus] = await Promise.all([
          contract.getPolicy(policyId),
          contract.getEffectivePolicyStatus(policyId),
        ]);
        const policyPackage = await contract.getPolicyPackage(policy.packageId);
        return formatPolicy(policy, effectiveStatus, policyPackage);
      })
    );

    res.status(200).json({
      success: true,
      count: policies.length,
      pagination,
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

      const economics = await getPolicyEconomics(contract);
      const [terms, coverageAccount, coverageIntervals] = await Promise.all([
        economics.getPolicyTerms(req.params.policyId),
        economics.getCoverageAccount(req.params.policyId),
        economics.getCoverageIntervals(req.params.policyId),
      ]);

    res.status(200).json({
      success: true,
      policy: formatPolicy(
        policy,
        effectiveStatus,
        await contract.getPolicyPackage(policy.packageId)
        ),
        economics: {
          terms: formatEconomicValue(terms),
          coverage: formatEconomicValue(coverageAccount),
          intervals: formatEconomicValue(coverageIntervals),
          remainingCoverageWei: (
            await economics.remainingCoverage(req.params.policyId)
          ).toString(),
        },
      });
  } catch (error) {
    next(error);
  }
};

const previewPurchasedPolicyEligibility = async (req, res, next) => {
  try {
    const contract = getReadOnlyContract();
    const policy = await contract.getPolicy(req.params.policyId);

    if (!canReadPolicy(req, policy)) {
      return res.status(403).json({
        success: false,
        message: "Access denied: policy does not belong to this wallet",
      });
    }

    const policyPackage = await contract.getPolicyPackage(policy.packageId);
    const evaluation = evaluatePolicyEligibility(
      buildEligibilityInput({ policy, policyPackage, body: req.body })
    );

    res.status(200).json({
      success: true,
      policy: formatPolicy(policy, policy.status, policyPackage),
      evaluation,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  acceptPublicPolicyTerms,
  downloadPublicPolicyDocument,
  getActivePolicyPackages,
  getPublicPolicyPackage,
  getPolicyRuleCatalog,
  getRealisticScenarios,
  getRiskPremiumQuote,
  getMyPolicies,
  getPolicyById,
  previewPurchasedPolicyEligibility,
  simulateHistoricalPolicyEligibility,
};
