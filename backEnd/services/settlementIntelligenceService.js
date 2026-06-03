const { ethers } = require("ethers");
const { getReadOnlyContract } = require("./contractService");

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

const SETTLE_READY_STATUSES = new Set(["APPROVED"]);
const OPEN_EXPOSURE_STATUSES = new Set([
  "SUBMITTED",
  "DUPLICATE_CHECKED",
  "ORACLE_PENDING",
  "ORACLE_VERIFIED",
  "MANUAL_REVIEW",
  "APPROVED",
]);
const REVIEW_EXPOSURE_STATUSES = new Set([
  "FRAUD_FLAGGED",
  "ORACLE_FAILED",
  "MANUAL_REVIEW",
]);

const DEDUCTIBLE_RATE = 0.1;
const DEDUCTIBLE_CAP_ETH = "0.02";
const INSURER_SHARE_RATE = 0.8;

const zeroWei = 0n;

const toEth = (weiValue) => ethers.formatEther(weiValue);

const toNumberEth = (weiValue) => Number(ethers.formatEther(weiValue));

const getStatusName = (claim) => {
  return CLAIM_STATUS[Number(claim.status)] || "UNKNOWN";
};

const formatRatio = (numerator, denominator) => {
  if (denominator === zeroWei) {
    return numerator > zeroWei ? null : 1;
  }

  return Number((Number(numerator) / Number(denominator)).toFixed(4));
};

const addAmount = (currentValue, amount) => currentValue + amount;

const getSolvencyStatus = ({ reserveWei, approvedLiabilityWei, openExposureWei }) => {
  if (approvedLiabilityWei > reserveWei) {
    return "DEFICIT_APPROVED_CLAIMS";
  }

  if (openExposureWei > reserveWei) {
    return "WATCH_OPEN_EXPOSURE";
  }

  return "SUFFICIENT";
};

const getDeductibleModel = (claimAmountWei) => {
  const deductibleCapWei = ethers.parseEther(DEDUCTIBLE_CAP_ETH);
  const rateDeductibleWei = (claimAmountWei * BigInt(Math.round(DEDUCTIBLE_RATE * 100))) / 100n;
  const deductibleWei =
    rateDeductibleWei < deductibleCapWei ? rateDeductibleWei : deductibleCapWei;
  const remainingWei =
    claimAmountWei > deductibleWei ? claimAmountWei - deductibleWei : zeroWei;
  const insurerShareWei =
    (remainingWei * BigInt(Math.round(INSURER_SHARE_RATE * 100))) / 100n;
  const claimantShareWei = claimAmountWei - insurerShareWei;

  return {
    model: "advisory_deductible_coinsurance",
    note: "Advisory off-chain calculation only; current smart contract settlement still pays approved claim amount.",
    deductibleRate: DEDUCTIBLE_RATE,
    deductibleCapEth: DEDUCTIBLE_CAP_ETH,
    insurerShareRate: INSURER_SHARE_RATE,
    claimantShareRate: Number((1 - INSURER_SHARE_RATE).toFixed(2)),
    deductibleWei: deductibleWei.toString(),
    deductibleEth: toEth(deductibleWei),
    insurerShareWei: insurerShareWei.toString(),
    insurerShareEth: toEth(insurerShareWei),
    claimantShareWei: claimantShareWei.toString(),
    claimantShareEth: toEth(claimantShareWei),
  };
};

const formatClaimForSettlement = ({ claim, reserveAfterPreviousWei }) => {
  const statusName = getStatusName(claim);
  const claimAmountWei = claim.claimAmount;
  const projectedReserveAfterWei =
    reserveAfterPreviousWei >= claimAmountWei
      ? reserveAfterPreviousWei - claimAmountWei
      : zeroWei;

  return {
    claimId: claim.claimId.toString(),
    policyId: claim.policyId.toString(),
    claimantWallet: claim.claimantWallet,
    claimType: claim.claimType,
    hospitalId: claim.hospitalId,
    status: statusName,
    claimAmountWei: claimAmountWei.toString(),
    claimAmountEth: toEth(claimAmountWei),
    canSettleWithCurrentReserve: reserveAfterPreviousWei >= claimAmountWei,
    projectedReserveAfterWei: projectedReserveAfterWei.toString(),
    projectedReserveAfterEth: toEth(projectedReserveAfterWei),
    settlementModel: getDeductibleModel(claimAmountWei),
  };
};

const formatPolicy = (policy) => ({
  policyId: policy.policyId.toString(),
  packageId: policy.packageId.toString(),
  holderWallet: policy.holderWallet,
  coverageAmountWei: policy.coverageAmount.toString(),
  coverageAmountEth: toEth(policy.coverageAmount),
  premiumPaidWei: policy.premiumPaid.toString(),
  premiumPaidEth: toEth(policy.premiumPaid),
  isActive: policy.isActive,
  startDate: policy.startDate.toString(),
  endDate: policy.endDate.toString(),
});

const getAllClaims = async (contract) => {
  const nextClaimId = await contract.claimCounter();
  const totalClaims = Number(nextClaimId) - 1;
  const claims = [];

  for (let claimId = 1; claimId <= totalClaims; claimId += 1) {
    claims.push(await contract.getClaim(claimId));
  }

  return claims;
};

const getAllPolicies = async (contract) => {
  const nextPolicyId = await contract.policyCounter();
  const totalPolicies = Number(nextPolicyId) - 1;
  const policies = [];

  for (let policyId = 1; policyId <= totalPolicies; policyId += 1) {
    policies.push(await contract.getPolicy(policyId));
  }

  return policies;
};

const buildStatusBreakdown = (claims) => {
  const breakdown = Object.fromEntries(
    CLAIM_STATUS.map((status) => [
      status,
      {
        count: 0,
        amountWei: "0",
        amountEth: "0.0",
      },
    ])
  );
  const totals = Object.fromEntries(CLAIM_STATUS.map((status) => [status, zeroWei]));

  claims.forEach((claim) => {
    const statusName = getStatusName(claim);
    totals[statusName] = addAmount(totals[statusName] || zeroWei, claim.claimAmount);
    breakdown[statusName].count += 1;
  });

  Object.entries(totals).forEach(([status, amountWei]) => {
    breakdown[status].amountWei = amountWei.toString();
    breakdown[status].amountEth = toEth(amountWei);
  });

  return breakdown;
};

const buildReserveIntelligence = async () => {
  const contract = getReadOnlyContract();
  const [reserveWei, claims, policies] = await Promise.all([
    contract.getContractBalance(),
    getAllClaims(contract),
    getAllPolicies(contract),
  ]);
  const activePolicies = policies.filter((policy) => policy.isActive);
  const activeCoverageWei = activePolicies.reduce(
    (total, policy) => total + policy.coverageAmount,
    zeroWei
  );
  const premiumCollectedWei = policies.reduce(
    (total, policy) => total + policy.premiumPaid,
    zeroWei
  );
  const openExposureWei = claims
    .filter((claim) => OPEN_EXPOSURE_STATUSES.has(getStatusName(claim)))
    .reduce((total, claim) => total + claim.claimAmount, zeroWei);
  const reviewExposureWei = claims
    .filter((claim) => REVIEW_EXPOSURE_STATUSES.has(getStatusName(claim)))
    .reduce((total, claim) => total + claim.claimAmount, zeroWei);
  const approvedLiabilityWei = claims
    .filter((claim) => SETTLE_READY_STATUSES.has(getStatusName(claim)))
    .reduce((total, claim) => total + claim.claimAmount, zeroWei);
  const settledWei = claims
    .filter((claim) => getStatusName(claim) === "SETTLED")
    .reduce((total, claim) => total + claim.claimAmount, zeroWei);
  const pendingSettlementClaims = claims.filter((claim) =>
    SETTLE_READY_STATUSES.has(getStatusName(claim))
  );
  let rollingReserveWei = reserveWei;
  const settlementQueue = pendingSettlementClaims.map((claim) => {
    const formattedClaim = formatClaimForSettlement({
      claim,
      reserveAfterPreviousWei: rollingReserveWei,
    });

    if (rollingReserveWei >= claim.claimAmount) {
      rollingReserveWei -= claim.claimAmount;
    }

    return formattedClaim;
  });
  const reserveAfterQueueWei = rollingReserveWei;
  const reserveToOpenExposureRatio = formatRatio(reserveWei, openExposureWei);
  const reserveToApprovedLiabilityRatio = formatRatio(
    reserveWei,
    approvedLiabilityWei
  );
  const reserveToCoverageRatio = formatRatio(reserveWei, activeCoverageWei);

  return {
    generatedAt: new Date().toISOString(),
    assumptions: {
      settlementModel:
        "Advisory off-chain reserve intelligence. Contract settlement remains unchanged.",
      openExposureStatuses: Array.from(OPEN_EXPOSURE_STATUSES),
      reviewExposureStatuses: Array.from(REVIEW_EXPOSURE_STATUSES),
      settlementReadyStatuses: Array.from(SETTLE_READY_STATUSES),
      deductibleRate: DEDUCTIBLE_RATE,
      deductibleCapEth: DEDUCTIBLE_CAP_ETH,
      insurerShareRate: INSURER_SHARE_RATE,
    },
    reserve: {
      wei: reserveWei.toString(),
      eth: toEth(reserveWei),
    },
    portfolio: {
      totalPolicies: policies.length,
      activePolicies: activePolicies.length,
      totalClaims: claims.length,
      premiumCollectedWei: premiumCollectedWei.toString(),
      premiumCollectedEth: toEth(premiumCollectedWei),
      activeCoverageWei: activeCoverageWei.toString(),
      activeCoverageEth: toEth(activeCoverageWei),
    },
    liabilities: {
      openExposureWei: openExposureWei.toString(),
      openExposureEth: toEth(openExposureWei),
      approvedLiabilityWei: approvedLiabilityWei.toString(),
      approvedLiabilityEth: toEth(approvedLiabilityWei),
      reviewExposureWei: reviewExposureWei.toString(),
      reviewExposureEth: toEth(reviewExposureWei),
      settledWei: settledWei.toString(),
      settledEth: toEth(settledWei),
    },
    ratios: {
      reserveToOpenExposure: reserveToOpenExposureRatio,
      reserveToApprovedLiability: reserveToApprovedLiabilityRatio,
      reserveToActiveCoverage: reserveToCoverageRatio,
    },
    solvency: {
      status: getSolvencyStatus({
        reserveWei,
        approvedLiabilityWei,
        openExposureWei,
      }),
      approvedClaimsFullyCovered: reserveWei >= approvedLiabilityWei,
      openExposureFullyCovered: reserveWei >= openExposureWei,
      reserveAfterApprovedQueueWei: reserveAfterQueueWei.toString(),
      reserveAfterApprovedQueueEth: toEth(reserveAfterQueueWei),
      coverageUtilizationPercent:
        activeCoverageWei === zeroWei
          ? 0
          : Number(
              ((toNumberEth(openExposureWei) / toNumberEth(activeCoverageWei)) * 100).toFixed(2)
            ),
    },
    claimStatusBreakdown: buildStatusBreakdown(claims),
    settlementQueue,
    recentPolicies: policies.slice(-5).reverse().map(formatPolicy),
  };
};

module.exports = {
  buildReserveIntelligence,
};
