const { ethers } = require("ethers");
const { getReadOnlyContract } = require("../services/contractService");
const { getPolicyTerms } = require("../services/policyRuleService");
const {
  formatBenefitRequest,
  formatTerms,
  getAdminBenefitsContract,
  getPolicyBenefitsSnapshot,
  getReadOnlyBenefitsContract,
} = require("../services/policyBenefitsService");
const { logAdminAction } = require("../services/adminActionLogService");

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const canReadBenefits = (req, policy, snapshot) => {
  if (["ADMIN", "AUDITOR"].includes(req.user.role)) return true;
  const wallet = req.user.walletAddress.toLowerCase();
  return (
    policy.holderWallet.toLowerCase() === wallet ||
    snapshot.beneficiaries.some(
      (beneficiary) => beneficiary.account.toLowerCase() === wallet
    )
  );
};

const loadReadableSnapshot = async (req, policyId) => {
  const insurance = getReadOnlyContract();
  const policy = await insurance.getPolicy(policyId);
  const snapshot = await getPolicyBenefitsSnapshot(policy);
  if (!canReadBenefits(req, policy, snapshot)) {
    throw createError("Access denied: wallet is not a policy party", 403);
  }
  const policyPackage = await insurance.getPolicyPackage(policy.packageId);
  return { policy, policyPackage, snapshot };
};

const getPolicyBenefits = async (req, res, next) => {
  try {
    const { policy, policyPackage, snapshot } = await loadReadableSnapshot(
      req,
      req.params.policyId
    );
    res.status(200).json({
      success: true,
      policy: {
        policyId: policy.policyId.toString(),
        packageId: policy.packageId.toString(),
        packageName: policyPackage.name,
        holderWallet: policy.holderWallet,
        status: Number(policy.status),
        installmentsPaid: policy.installmentsPaid.toString(),
        totalPremiumPaidEth: ethers.formatEther(policy.totalPremiumPaid),
        coverageAmountEth: ethers.formatEther(policy.coverageAmount),
        startDate: policy.startDate.toString(),
        endDate: policy.endDate.toString(),
      },
      ...snapshot,
    });
  } catch (error) {
    next(error);
  }
};

const buildPolicyMarkdown = ({ policy, policyPackage, snapshot }) => {
  const healthTerms = getPolicyTerms(policyPackage);
  const benefitTerms = snapshot.terms;
  const beneficiaries = snapshot.beneficiaries.length
    ? snapshot.beneficiaries
        .map(
          (beneficiary, index) =>
            `${index + 1}. ${beneficiary.account} — ${beneficiary.sharePercent}%`
        )
        .join("\n")
    : "No beneficiaries registered.";

  return `# ${policyPackage.name} — Policy Terms and Benefit Schedule

Policy ID: ${policy.policyId}
Package ID: ${policy.packageId}
Holder: ${policy.holderWallet}
Coverage period: ${new Date(Number(policy.startDate) * 1000).toISOString()} to ${new Date(Number(policy.endDate) * 1000).toISOString()}

## Core Health Coverage

- Rule profile: ${healthTerms.displayName} v${healthTerms.version}
- Initial waiting period: ${healthTerms.waitingPeriodDays} days
- Pre-existing-condition waiting period: ${healthTerms.preExistingConditionWaitingDays} days
- Insurer share: ${healthTerms.coinsuranceBps / 100}%
- Covered claim types: ${healthTerms.coveredClaimTypes.join(", ")}
- Exclusions: ${healthTerms.excludedClaimTypes.join(", ")}

## Additional Benefits

- Published benefit version: ${benefitTerms.version || "Not configured"}
- Terms commitment: ${benefitTerms.termsHash}
- Death benefit: ${benefitTerms.deathBenefitEnabled ? `${benefitTerms.deathBenefitPercent}% of coverage` : "Disabled"}
- Surrender value: ${benefitTerms.surrenderEnabled ? `${benefitTerms.surrenderValuePercent}% of premiums after ${benefitTerms.minimumSurrenderInstallments} installments and policy cancellation` : "Disabled"}
- Maturity benefit: ${benefitTerms.maturityEnabled ? `premiums paid plus ${benefitTerms.maturityBonusPercent}%` : "Disabled"}

## Current Benefit Projections

- Death: ${snapshot.projections.death.eth} ETH
- Surrender: ${snapshot.projections.surrender.eth} ETH
- Maturity: ${snapshot.projections.maturity.eth} ETH

## Registered Beneficiaries

${beneficiaries}

## Important Notice

This document is generated from the policy's current blockchain records and published rule commitments. Benefit requests require the applicable lifecycle status, evidence where required, administrator review, and sufficient reserved funds. The deployed contracts remain authoritative.
`;
};

const downloadPolicyTerms = async (req, res, next) => {
  try {
    const policyData = await loadReadableSnapshot(req, req.params.policyId);
    const markdown = buildPolicyMarkdown(policyData);
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="policy-${req.params.policyId}-terms.md"`
    );
    res.status(200).send(markdown);
  } catch (error) {
    next(error);
  }
};

const parsePercentageBps = (value, field) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    throw createError(`${field} must be between 0 and 100`);
  }
  return Math.round(numeric * 100);
};

const publishBenefitTerms = async (req, res, next) => {
  try {
    const packageId = String(req.params.packageId);
    const input = {
      packageId,
      deathBenefitEnabled: req.body.deathBenefitEnabled === true,
      surrenderEnabled: req.body.surrenderEnabled === true,
      maturityEnabled: req.body.maturityEnabled === true,
      deathBenefitBps: parsePercentageBps(
        req.body.deathBenefitPercent,
        "deathBenefitPercent"
      ),
      surrenderValueBps: parsePercentageBps(
        req.body.surrenderValuePercent,
        "surrenderValuePercent"
      ),
      maturityBonusBps: parsePercentageBps(
        req.body.maturityBonusPercent,
        "maturityBonusPercent"
      ),
      minimumSurrenderInstallments: Number(
        req.body.minimumSurrenderInstallments
      ),
      version: Number(req.body.version),
    };
    if (
      !Number.isInteger(input.version) ||
      input.version < 1 ||
      !Number.isInteger(input.minimumSurrenderInstallments) ||
      input.minimumSurrenderInstallments < 0
    ) {
      throw createError("Version and minimum installments must be valid integers");
    }
    const termsHash = ethers.keccak256(
      ethers.toUtf8Bytes(JSON.stringify(input))
    );
    const contract = getAdminBenefitsContract();
    const tx = await contract.publishBenefitTerms(
      packageId,
      input.deathBenefitEnabled,
      input.surrenderEnabled,
      input.maturityEnabled,
      input.deathBenefitBps,
      input.surrenderValueBps,
      input.maturityBonusBps,
      input.minimumSurrenderInstallments,
      input.version,
      termsHash
    );
    const receipt = await tx.wait();
    await logAdminAction({
      req,
      action: "PUBLISH_BENEFIT_TERMS",
      targetType: "POLICY_PACKAGE",
      targetId: packageId,
      tx,
      receipt,
      metadata: { ...input, termsHash },
    });
    res.status(200).json({
      success: true,
      message: "Benefit terms published on-chain",
      transactionHash: tx.hash,
      termsHash,
      terms: input,
    });
  } catch (error) {
    next(error);
  }
};

const getPackageBenefitTerms = async (req, res, next) => {
  try {
    const contract = getReadOnlyBenefitsContract();
    const terms = await contract.getBenefitTerms(req.params.packageId);
    res.status(200).json({ success: true, terms: formatTerms(terms) });
  } catch (error) {
    next(error);
  }
};

const listBenefitRequests = async (req, res, next) => {
  try {
    const contract = getReadOnlyBenefitsContract();
    const counter = Number(await contract.requestCounter());
    const start = Math.max(1, counter - 100);
    const requests = await Promise.all(
      Array.from({ length: counter - start }, (_, index) => counter - index - 1).map(
        async (requestId) =>
          formatBenefitRequest(await contract.getBenefitRequest(requestId))
      )
    );
    res.status(200).json({ success: true, count: requests.length, requests });
  } catch (error) {
    next(error);
  }
};

const resolveBenefitRequest = (action) => async (req, res, next) => {
  try {
    const contract = getAdminBenefitsContract();
    let tx;
    if (action === "REJECT") {
      const reason = String(req.body.reason || "").trim();
      if (!reason) throw createError("Rejection reason is required");
      tx = await contract.rejectBenefit(
        req.params.requestId,
        ethers.keccak256(ethers.toUtf8Bytes(reason))
      );
    } else if (action === "APPROVE") {
      tx = await contract.approveBenefit(req.params.requestId);
    } else {
      tx = await contract.settleBenefit(req.params.requestId);
    }
    const receipt = await tx.wait();
    await logAdminAction({
      req,
      action: `${action}_BENEFIT_REQUEST`,
      targetType: "BENEFIT_REQUEST",
      targetId: req.params.requestId,
      tx,
      receipt,
    });
    res.status(200).json({
      success: true,
      message: `Benefit request ${
        { APPROVE: "approved", REJECT: "rejected", SETTLE: "settled" }[action]
      } successfully`,
      transactionHash: tx.hash,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  approveBenefitRequest: resolveBenefitRequest("APPROVE"),
  downloadPolicyTerms,
  getPackageBenefitTerms,
  getPolicyBenefits,
  listBenefitRequests,
  publishBenefitTerms,
  rejectBenefitRequest: resolveBenefitRequest("REJECT"),
  settleBenefitRequest: resolveBenefitRequest("SETTLE"),
};
