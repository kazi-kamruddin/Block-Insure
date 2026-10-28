const { ethers } = require("ethers");

const list = (values) => values.length ? values.join(", ") : "None";
const buildPolicyDocument = ({ policyPackage }) => {
  const terms = policyPackage.policyTerms;
  if (!terms?.authoritative) throw new Error("Published contract terms are required for an application policy document");
  const documentVersion = `medical-rules.${terms.version}-schedule.2`;
  const periods = Math.ceil(Number(policyPackage.durationDays) / 90);
  const finalDays = Number(policyPackage.durationDays) % 90 || 90;
  const finalWei = periods === 1 ? BigInt(policyPackage.premiumAmountWei) :
    (BigInt(policyPackage.premiumAmountWei) * BigInt(finalDays) + 89n) / 90n;
  const markdown = `# ${policyPackage.name} — Issued Medical Coverage Terms

Document version: ${documentVersion}
Package ID: ${policyPackage.packageId}
Deployment: ${policyPackage.deploymentScope}
Issue commitment: ${policyPackage.issueHash}
Policy rule commitment: ${terms.policyRuleVersion}
Settlement formula commitment: ${terms.settlementFormulaVersion}

## Coverage and settlement

- Policy type: ${policyPackage.policyType}
- Term from purchase: ${policyPackage.durationDays} days
- Aggregate insurer liability limit: ${policyPackage.coverageAmountEth} test ETH
- Maximum submitted claim: ${ethers.formatEther(terms.maximumClaimWei)} test ETH
- Initial waiting period: ${terms.waitingPeriodDays} days
- Reinstatement waiting period: ${terms.reinstatementWaitingPeriodDays} days
- Claim submission deadline: ${terms.claimDeadlineDays} days after the incident
- Eligible service codes: ${list(terms.coveredClaimTypes)}
- Excluded service codes: ${list(terms.excludedClaimTypes)}
- Primary document required: ${policyPackage.requiredDocumentType} (one commitment; plaintext authenticity is checked separately)
- Deductible: ${terms.deductibleRateBps / 100}% of the claim, capped at ${ethers.formatEther(terms.deductibleCapWei)} test ETH
- Insurer share after deductible: ${terms.coinsuranceBps / 100}%
- Formula: floor((claim - min(floor(claim × deductible basis points / 10000), deductible cap)) × insurer share basis points / 10000)

A claim whose calculated liability exceeds remaining aggregate coverage is rejected; the contract does not silently reduce it. Eligibility also requires a paid coverage interval, hospital-record integrity, patient authorization and the applicable Oracle/review process. An estimate is not claim approval.

## Fixed installment schedule

- First installment at purchase: ${policyPackage.premiumAmountEth} test ETH
- Calendar periods are anchored to purchase, every 90 days: ${periods} periods for this term
- Last period: ${finalDays} days; charge ${ethers.formatEther(finalWei)} test ETH (a subsequent short final period is prorated, rounded up in wei)
- Only the next unpaid period can be paid, starting 30 days before its due date; no bulk prepayment
- Early payment keeps the original calendar dates
- Seven-day collection grace does not extend medical coverage past the unpaid due date
- Reinstatement charges the current calendar period at its scheduled price, excludes the missed interval and applies the reinstatement wait; skipped periods are not arrears
- No premium collection after the term is fully paid or expired

Wallet payment, manual bank OTP and authorized automatic collection settle the same installment. The banking gateway illustrates a simulated BDT balance and fixed exchange quote; its funded gateway wallet supplies actual test ETH. It does not access or debit a real bank account. Native funds go to the medical manager, separately from the optional benefit vault.

## Scope and acceptance

Pre-existing-condition underwriting is not implemented or promised. Death and maturity products are not offered in this release. An optional cancellation refund requires its own accepted schedule, at least two scheduled paid installments, cancellation, insurer review and a separately funded reserve. It is a fixed contractual refund, not a savings return. Paid incidents retain their original reporting deadline; this medical purchase does not include a later-changing refund schedule.

The application records acceptance of this document and submits its hash with the expected offer commitment. The contract rejects changed offers and records the document hash with the issued policy. A low-level protocol purchase without this document has no application acceptance binding and is identified as such.

${terms.notice}
`;
  return { documentVersion, documentHash: ethers.id(markdown), benefitVersion: 0, markdown };
};
module.exports = { buildPolicyDocument };
