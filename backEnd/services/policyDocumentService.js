const { ethers } = require("ethers");

const { getPolicyTerms } = require("./policyRuleService");

const normalizeList = (values = []) =>
  values.map((value) => String(value).replaceAll("_", " ")).join(", ");

const formatBenefit = (enabled, enabledText) =>
  enabled ? enabledText : "Not included in the current benefit schedule";

const buildPolicyDocument = ({ policyPackage, benefitTerms = null }) => {
  const healthTerms = getPolicyTerms(policyPackage);
  const benefitVersion = benefitTerms?.configured ? Number(benefitTerms.version) : 0;
  const documentVersion = `${healthTerms.version}-benefits.${benefitVersion}`;
  const premiumInterval = "Recurring installment schedule shown in the issued policy";

  const markdown = `# ${policyPackage.name} — Full Policy Terms

Document version: ${documentVersion}
Package ID: ${policyPackage.packageId}
Policy type: ${policyPackage.policyType}

## Policy Schedule

- Premium: ${policyPackage.premiumAmountEth} ETH
- Coverage limit: ${policyPackage.coverageAmountEth} ETH
- Coverage duration: ${policyPackage.durationDays} days
- Premium schedule: ${premiumInterval}
- Required claim document: ${policyPackage.requiredDocumentType}

## Eligibility and Waiting Periods

- Rule profile: ${healthTerms.displayName} v${healthTerms.version}
- Initial waiting period: ${healthTerms.waitingPeriodDays} days
- Pre-existing-condition waiting period: ${healthTerms.preExistingConditionWaitingDays} days
- Insurer share after applicable limits: ${healthTerms.coinsuranceBps / 100}%
- Covered claim types: ${normalizeList(healthTerms.coveredClaimTypes)}
- Exclusions: ${normalizeList(healthTerms.excludedClaimTypes)}
- Required disclosures: ${normalizeList(healthTerms.requiredDisclosures) || "None"}

## Additional Benefits

- Death benefit: ${formatBenefit(
    benefitTerms?.deathBenefitEnabled,
    `${benefitTerms?.deathBenefitPercent}% of coverage, subject to verification`
  )}
- Surrender value: ${formatBenefit(
    benefitTerms?.surrenderEnabled,
    `${benefitTerms?.surrenderValuePercent}% of eligible premiums after ${benefitTerms?.minimumSurrenderInstallments} installments`
  )}
- Maturity benefit: ${formatBenefit(
    benefitTerms?.maturityEnabled,
    `eligible premiums plus a ${benefitTerms?.maturityBonusPercent}% bonus`
  )}
- Published benefit commitment: ${benefitTerms?.termsHash || "Not configured"}

## Claims and Evidence

Claims must occur during active coverage and satisfy the applicable waiting period, coverage, disclosure, document, hospital-record, fraud-screening, and verification requirements. A preview or estimate is advisory and does not approve a claim.

## Surrender and Cancellation

A surrender estimate may be viewed without changing the policy. An actual surrender requires the configured minimum installments, policy cancellation, a benefit request, review, and sufficient allocated funds.

## Digital Acceptance

Purchasing this package requires the policyholder to accept this exact document version and cryptographic hash. The deployed contracts and the terms snapshotted for the issued policy remain authoritative.

## Important Notice

${healthTerms.notice}
`;

  return {
    documentVersion,
    documentHash: ethers.keccak256(ethers.toUtf8Bytes(markdown)),
    benefitVersion,
    markdown,
  };
};

module.exports = { buildPolicyDocument };
