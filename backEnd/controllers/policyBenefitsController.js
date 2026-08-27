const { ethers } = require("ethers");
const { getReadOnlyContract } = require("../services/contractService");
const { getPolicyTerms } = require("../services/policyRuleService");
const {
  formatBenefitRequest,
  formatTerms,
  getBenefitsAddress,
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
  const [policy, effectiveStatus] = await Promise.all([
    insurance.getPolicy(policyId),
    insurance.getEffectivePolicyStatus(policyId),
  ]);
  const snapshot = await getPolicyBenefitsSnapshot(
    policy,
    req.user.walletAddress
  );
  if (!canReadBenefits(req, policy, snapshot)) {
    throw createError("Access denied: wallet is not a policy party", 403);
  }
  const policyPackage = await insurance.getPolicyPackage(policy.packageId);
  return { policy, policyPackage, snapshot, effectiveStatus };
};

const getPolicyBenefits = async (req, res, next) => {
  try {
    const { policy, policyPackage, snapshot, effectiveStatus } = await loadReadableSnapshot(
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
        status: Number(effectiveStatus),
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

- Accepted benefit version: ${snapshot.acceptedTermsVersion || "Not yet accepted"}
- Latest preview version: ${snapshot.termsAcceptanceRequired ? benefitTerms.version : "Same as accepted version"}
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

const getConfirmedBenefitsTransaction = async (req, expectedFunction) => {
  const transactionHash = String(req.body.transactionHash || "").trim();
  if (!/^0x[a-f\d]{64}$/i.test(transactionHash)) {
    throw createError("A valid transactionHash is required");
  }

  const contract = getReadOnlyBenefitsContract();
  const provider = contract.runner;
  const [transaction, receipt] = await Promise.all([
    provider.getTransaction(transactionHash),
    provider.getTransactionReceipt(transactionHash),
  ]);
  if (!transaction || !receipt) {
    throw createError("Benefit transaction is not confirmed", 409);
  }
  if (Number(receipt.status) !== 1) {
    throw createError("Benefit transaction reverted", 409);
  }
  if (
    transaction.to?.toLowerCase() !== getBenefitsAddress().toLowerCase() ||
    transaction.from.toLowerCase() !== req.user.walletAddress.toLowerCase()
  ) {
    throw createError("Transaction sender or target does not match this request", 403);
  }

  const parsed = contract.interface.parseTransaction({
    data: transaction.data,
    value: transaction.value,
  });
  if (parsed?.name !== expectedFunction) {
    throw createError(`Transaction does not execute ${expectedFunction}`, 409);
  }

  return { parsed, receipt, transactionHash };
};

const confirmPublishedBenefitTerms = async (req, res, next) => {
  try {
    const packageId = String(req.params.packageId);
    const { parsed, receipt, transactionHash } =
      await getConfirmedBenefitsTransaction(req, "publishBenefitTerms");
    if (parsed.args.packageId.toString() !== packageId) {
      throw createError("Confirmed transaction targets another policy package", 409);
    }
    await logAdminAction({
      req,
      action: "PUBLISH_BENEFIT_TERMS",
      targetType: "POLICY_PACKAGE",
      targetId: packageId,
      tx: { hash: transactionHash },
      receipt,
      metadata: {
        deathBenefitEnabled: parsed.args.deathBenefitEnabled,
        surrenderEnabled: parsed.args.surrenderEnabled,
        maturityEnabled: parsed.args.maturityEnabled,
        deathBenefitBps: parsed.args.deathBenefitBps,
        surrenderValueBps: parsed.args.surrenderValueBps,
        maturityBonusBps: parsed.args.maturityBonusBps,
        minimumSurrenderInstallments: parsed.args.minimumSurrenderInstallments,
        version: parsed.args.version,
        termsHash: parsed.args.termsHash,
      },
    });
    res.status(200).json({
      success: true,
      message: "Benefit terms transaction verified and audited",
      transactionHash,
      termsHash: parsed.args.termsHash,
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
    const functionName = {
      APPROVE: "approveBenefit",
      REJECT: "rejectBenefit",
      SETTLE: "settleBenefit",
    }[action];
    const { parsed, receipt, transactionHash } =
      await getConfirmedBenefitsTransaction(req, functionName);
    if (parsed.args.requestId.toString() !== String(req.params.requestId)) {
      throw createError("Confirmed transaction targets another benefit request", 409);
    }
    await logAdminAction({
      req,
      action: `${action}_BENEFIT_REQUEST`,
      targetType: "BENEFIT_REQUEST",
      targetId: req.params.requestId,
      tx: { hash: transactionHash },
      receipt,
      metadata:
        action === "REJECT"
          ? { decisionReasonHash: parsed.args.reasonHash }
          : {},
    });
    res.status(200).json({
      success: true,
      message: `Benefit request ${
        { APPROVE: "approved", REJECT: "rejected", SETTLE: "allocated" }[action]
      } successfully`,
      transactionHash,
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
  confirmPublishedBenefitTerms,
  rejectBenefitRequest: resolveBenefitRequest("REJECT"),
  settleBenefitRequest: resolveBenefitRequest("SETTLE"),
};
