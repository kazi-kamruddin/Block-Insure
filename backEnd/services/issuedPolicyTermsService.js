const { ethers } = require("ethers");
const { getPolicyEconomics } = require("./contractService");
const { getDeploymentScope } = require("./deploymentScopeService");
const Publication = require("../models/PolicyRulePublication");
const Acceptance = require("../models/PolicyTermsAcceptance");
const { POLICY_RULES } = require("../config/policyRules");
const { readPaymentSchedule } = require("./paymentScheduleService");

const known = [...new Set([...Object.values(POLICY_RULES).flatMap((rules) => [...rules.coveredClaimTypes, ...rules.excludedClaimTypes]), "HEALTH", "DIAGNOSTIC"])];
const formatTerms = (raw, { allowed = [], excluded = [], labels = {} } = {}) => {
  const name = (hash) => labels[hash] || known.find((value) => ethers.id(value) === hash) || `service commitment ${hash}`;
  return {
    authoritative: true, ruleSetId: "ISSUED_CONTRACT_RULES", version: String(raw.packageRuleVersion ?? raw.version),
    displayName: "Contract medical coverage", summary: "Coverage follows the published and issued contract rules.",
    waitingPeriodDays: Number(raw.waitingPeriod) / 86400,
    reinstatementWaitingPeriodDays: Number(raw.reinstatementWaitingPeriod) / 86400,
    preExistingConditionWaitingDays: 0, requiredDisclosures: [],
    claimDeadlineDays: Number(raw.claimDeadline) / 86400,
    coinsuranceBps: Number(raw.insurerShareBps), deductibleRateBps: Number(raw.deductibleRateBps),
    deductibleCapWei: String(raw.deductibleCapWei), maximumClaimWei: String(raw.maximumClaimWei),
    minimumDocumentCommitments: Number(raw.minimumDocumentCommitments),
    allowedServiceHashes: [...allowed], excludedServiceHashes: [...excluded],
    coveredClaimTypes: allowed.map(name), excludedClaimTypes: excluded.map(name),
    policyRuleVersion: raw.policyRuleVersion, settlementFormulaVersion: raw.settlementFormulaVersion,
    exclusionsRoot: raw.exclusionsRoot, requiredDocumentsRoot: raw.requiredDocumentsRoot,
    notice: "Academic prototype using test ETH and institution-maintained records. Contract rules and coverage intervals govern eligibility. The preview does not verify medical evidence or approve payment. Pre-existing-condition underwriting is outside this product's implemented scope.",
  };
};

const readRuleLabels = async (packageId, version, hash, provider) => {
  const stored = await Publication.findOne({ deploymentScope: await getDeploymentScope(provider), packageId: String(packageId), version: String(version), policyRuleVersion: hash }).lean();
  if (!stored || ethers.id(stored.ruleDocument) !== hash) return {};
  try {
    const document = JSON.parse(stored.ruleDocument);
    const labels = {};
    for (const label of [...(document.allowedClaimTypes || []), ...(document.excludedClaimTypes || [])]) {
      if (typeof label === "string" && label.length <= 100) labels[ethers.id(label)] = label;
    }
    return labels;
  } catch { return {}; }
};

const getConfiguredTerms = async (contract, packageId) => {
  const economics = await getPolicyEconomics(contract);
  const version = await economics.currentPackageRuleVersion(packageId);
  if (version === 0n) return null;
  const [raw, allowed, excluded] = await economics.getPackageRules(packageId, version);
  const pkg = await contract.getPolicyPackage(packageId);
  const expectedDocumentRoot = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32[]"], [[ethers.id(pkg.requiredDocumentType)]]));
  if (pkg.requiredDocumentType !== "HOSPITAL_BILL" || raw.minimumDocumentCommitments !== 1n || raw.requiredDocumentsRoot !== expectedDocumentRoot) return null;
  if (!allowed.some((hash) => !excluded.includes(hash)) || raw.insurerShareBps === 0n) return null;
  const maximumClaimWei = raw.maximumClaimWei === 0n || raw.maximumClaimWei > pkg.coverageAmount ? pkg.coverageAmount : raw.maximumClaimWei;
  return { ...formatTerms({ ...raw.toObject(), maximumClaimWei }, { allowed, excluded, labels: await readRuleLabels(packageId, version, raw.policyRuleVersion, contract.runner.provider) }),
    paymentSchedule: await readPaymentSchedule(economics) };
};

const getIssuedTerms = async (contract, policyId) => {
  const economics = await getPolicyEconomics(contract);
  const raw = await economics.getPolicyTerms(policyId);
  let allowed = [], excluded = [];
  if (raw.packageRuleVersion > 0n) [, allowed, excluded] = await economics.getPackageRules(raw.packageId, raw.packageRuleVersion);
  // These reads are independent once issued terms have been loaded. Share
  // the request transport and preserve every value and deployment check.
  const [labels, intervals, remaining, paymentSchedule] = await Promise.all([
    readRuleLabels(raw.packageId, raw.packageRuleVersion, raw.policyRuleVersion, contract.runner.provider),
    economics.getCoverageIntervals(policyId), economics.remainingCoverage(policyId), readPaymentSchedule(economics),
  ]);
  const terms = formatTerms(raw, { allowed, excluded, labels });
  terms.coverageIntervals = intervals.map((interval) => ({
    startsAt: String(interval.startsAt), endsAt: String(interval.endsAt), waitingEndsAt: String(interval.waitingEndsAt),
  }));
  terms.remainingCoverageWei = String(remaining);
  terms.coverageLimitWei = String(raw.coverageLimitWei);
  terms.paymentSchedule = paymentSchedule;
  return terms;
};

const getInstallment = async (contract, policy) => {
  const economics = await getPolicyEconomics(contract);
  const quote = await economics.getInstallmentQuote(policy.policyId, policy.nextPremiumDueDate);
  return { installmentId: String(quote.installmentId), dueAt: String(quote.dueAt), endsAt: String(quote.endsAt),
    amountWei: String(quote.amountWei), amountEth: ethers.formatEther(quote.amountWei), opensAt: String(quote.opensAt),
    payableNow: quote.payableNow, reinstatement: quote.reinstatement };
};

const getIssuedDocument = async (contract, policy) => {
  const economics = await getPolicyEconomics(contract);
  const hash = await economics.issuedDocumentHash(policy.policyId);
  if (hash === ethers.ZeroHash) return { bound: false, notice: "This policy was issued through the low-level protocol API without an application document commitment." };
  const acceptance = await Acceptance.findOne({ deploymentScope: await getDeploymentScope(contract.runner.provider), walletAddress: policy.holderWallet.toLowerCase(),
    packageId: String(policy.packageId), documentHash: hash.toLowerCase() }).lean();
  if (!acceptance?.documentContent || ethers.id(acceptance.documentContent) !== hash) return { bound: true, documentHash: hash, available: false };
  return { bound: true, available: true, documentHash: hash, documentVersion: acceptance.documentVersion, content: acceptance.documentContent };
};

module.exports = { formatTerms, getConfiguredTerms, getIssuedTerms, getInstallment, getIssuedDocument };
