const { ethers } = require("ethers");
const { getContractBalance, getReadOnlyContract } = require("./contractService");

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

const toBpsRate = (bpsValue) => Number(bpsValue) / 10000;

const getSolvencyStatus = ({ reserveWei, approvedLiabilityWei, openExposureWei }) => {
  if (approvedLiabilityWei > reserveWei) {
    return "DEFICIT_APPROVED_CLAIMS";
  }

  if (openExposureWei > reserveWei) {
    return "WATCH_OPEN_EXPOSURE";
  }

  return "SUFFICIENT";
};

const formatSettlementModel = (settlement, params) => {
  return {
    model: "on_chain_deductible_coinsurance",
    note: "Settlement math is enforced by InsuranceManager.calculateSettlement and settleClaim transfers only insurerPays.",
    deductibleRateBps: params.deductibleRateBps.toString(),
    deductibleRate: toBpsRate(params.deductibleRateBps),
    deductibleCapWei: params.deductibleCapWei.toString(),
    deductibleCapEth: toEth(params.deductibleCapWei),
    insurerShareBps: params.insurerShareBps.toString(),
    insurerShareRate: toBpsRate(params.insurerShareBps),
    claimantShareRate: Number((1 - toBpsRate(params.insurerShareBps)).toFixed(4)),
    claimAmountWei: settlement.claimAmountWei.toString(),
    claimAmountEth: toEth(settlement.claimAmountWei),
    deductibleWei: settlement.deductibleWei.toString(),
    deductibleEth: toEth(settlement.deductibleWei),
    afterDeductibleWei: settlement.afterDeductibleWei.toString(),
    afterDeductibleEth: toEth(settlement.afterDeductibleWei),
    insurerShareWei: settlement.insurerPaysWei.toString(),
    insurerShareEth: toEth(settlement.insurerPaysWei),
    claimantShareWei: settlement.claimantResponsibilityWei.toString(),
    claimantShareEth: toEth(settlement.claimantResponsibilityWei),
  };
};

const normalizeSettlement = (rawSettlement) => ({
  claimAmountWei: rawSettlement.claimAmount,
  deductibleWei: rawSettlement.deductible,
  afterDeductibleWei: rawSettlement.afterDeductible,
  insurerPaysWei: rawSettlement.insurerPays,
  claimantResponsibilityWei: rawSettlement.claimantResponsibility,
});

const getSettlementQuote = async (contract, claim, params) => {
  const rawSettlement = await contract.calculateSettlement(claim.claimId);
  const settlement = normalizeSettlement(rawSettlement);

  return {
    ...settlement,
    settlementModel: formatSettlementModel(settlement, params),
  };
};

const formatClaimForSettlement = ({
  claim,
  reserveAfterPreviousWei,
  settlementQuote,
}) => {
  const statusName = getStatusName(claim);
  const claimAmountWei = claim.claimAmount;
  const insurerPaysWei = settlementQuote?.insurerPaysWei || claimAmountWei;
  const projectedReserveAfterWei =
    reserveAfterPreviousWei >= insurerPaysWei
      ? reserveAfterPreviousWei - insurerPaysWei
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
    canSettleWithCurrentReserve: reserveAfterPreviousWei >= insurerPaysWei,
    projectedReserveAfterWei: projectedReserveAfterWei.toString(),
    projectedReserveAfterEth: toEth(projectedReserveAfterWei),
    settlementModel: settlementQuote?.settlementModel || null,
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
  const [
    reserveWei,
    claims,
    policies,
    deductibleRateBps,
    deductibleCapWei,
    insurerShareBps,
    reserveWarningThresholdWei,
    highValueSettlementThresholdWei,
    enforcedReservedLiabilityWei,
  ] = await Promise.all([
    getContractBalance(),
    getAllClaims(contract),
    getAllPolicies(contract),
    contract.deductibleRateBps(),
    contract.deductibleCapWei(),
    contract.insurerShareBps(),
    contract.reserveWarningThresholdWei(),
    contract.highValueSettlementThresholdWei().catch(() => 0n),
    contract.totalReservedLiabilityWei().catch(() => 0n),
  ]);
  const settlementParams = {
    deductibleRateBps,
    deductibleCapWei,
    insurerShareBps,
  };
  const settlementQuotes = await Promise.all(
    claims.map(async (claim) => {
      const quote = await getSettlementQuote(contract, claim, settlementParams);

      return [claim.claimId.toString(), quote];
    })
  );
  const settlementQuoteByClaimId = new Map(settlementQuotes);
  const getClaimLiabilityWei = (claim) => {
    return (
      settlementQuoteByClaimId.get(claim.claimId.toString())?.insurerPaysWei ||
      claim.claimAmount
    );
  };
  const activePolicies = policies.filter((policy) => policy.isActive);
  const activeCoverageWei = activePolicies.reduce(
    (total, policy) => total + policy.coverageAmount,
    zeroWei
  );
  const premiumCollectedWei = policies.reduce(
    (total, policy) => total + (policy.totalPremiumPaid || policy.premiumPaid),
    zeroWei
  );
  const openExposureWei = claims
    .filter((claim) => OPEN_EXPOSURE_STATUSES.has(getStatusName(claim)))
    .reduce((total, claim) => total + getClaimLiabilityWei(claim), zeroWei);
  const reviewExposureWei = claims
    .filter((claim) => REVIEW_EXPOSURE_STATUSES.has(getStatusName(claim)))
    .reduce((total, claim) => total + getClaimLiabilityWei(claim), zeroWei);
  const approvedLiabilityWei = claims
    .filter((claim) => SETTLE_READY_STATUSES.has(getStatusName(claim)))
    .reduce((total, claim) => total + getClaimLiabilityWei(claim), zeroWei);
  const settledClaims = claims.filter((claim) => getStatusName(claim) === "SETTLED");
  const settlementRecords = await Promise.all(
    settledClaims.map(async (claim) => {
      try {
        return await contract.getSettlementRecord(claim.claimId);
      } catch (_) {
        return null;
      }
    })
  );
  const settledWei = settlementRecords.reduce((total, settlementRecord, index) => {
    if (settlementRecord) {
      return total + settlementRecord.amount;
    }

    return total + getClaimLiabilityWei(settledClaims[index]);
  }, zeroWei);
  const pendingSettlementClaims = claims.filter((claim) =>
    SETTLE_READY_STATUSES.has(getStatusName(claim))
  );
  let rollingReserveWei = reserveWei;
  const settlementQueue = pendingSettlementClaims.map((claim) => {
    const settlementQuote = settlementQuoteByClaimId.get(claim.claimId.toString());
    const formattedClaim = formatClaimForSettlement({
      claim,
      reserveAfterPreviousWei: rollingReserveWei,
      settlementQuote,
    });
    const insurerPaysWei = settlementQuote?.insurerPaysWei || claim.claimAmount;

    if (rollingReserveWei >= insurerPaysWei) {
      rollingReserveWei -= insurerPaysWei;
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
        "On-chain deductible/co-insurance formula enforced by InsuranceManager.settleClaim.",
      openExposureStatuses: Array.from(OPEN_EXPOSURE_STATUSES),
      reviewExposureStatuses: Array.from(REVIEW_EXPOSURE_STATUSES),
      settlementReadyStatuses: Array.from(SETTLE_READY_STATUSES),
      deductibleRateBps: deductibleRateBps.toString(),
      deductibleRate: toBpsRate(deductibleRateBps),
      deductibleCapWei: deductibleCapWei.toString(),
      deductibleCapEth: toEth(deductibleCapWei),
      insurerShareBps: insurerShareBps.toString(),
      insurerShareRate: toBpsRate(insurerShareBps),
    },
    reserve: {
      wei: reserveWei.toString(),
      eth: toEth(reserveWei),
      warningThresholdWei: reserveWarningThresholdWei.toString(),
      warningThresholdEth: toEth(reserveWarningThresholdWei),
      highValueSettlementThresholdWei: highValueSettlementThresholdWei.toString(),
      highValueSettlementThresholdEth: toEth(highValueSettlementThresholdWei),
      enforcedReservedLiabilityWei: enforcedReservedLiabilityWei.toString(),
      enforcedReservedLiabilityEth: toEth(enforcedReservedLiabilityWei),
      withdrawableExcessWei:
        reserveWei > enforcedReservedLiabilityWei
          ? (reserveWei - enforcedReservedLiabilityWei).toString()
          : "0",
      withdrawableExcessEth: toEth(
        reserveWei > enforcedReservedLiabilityWei
          ? reserveWei - enforcedReservedLiabilityWei
          : 0n
      ),
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
      approvedPendingExposureWei: approvedLiabilityWei.toString(),
      approvedPendingExposureEth: toEth(approvedLiabilityWei),
      unsettledApprovedClaimCount: pendingSettlementClaims.length,
      reviewExposureWei: reviewExposureWei.toString(),
      reviewExposureEth: toEth(reviewExposureWei),
      settledWei: settledWei.toString(),
      settledEth: toEth(settledWei),
      totalSettlementsPaidWei: settledWei.toString(),
      totalSettlementsPaidEth: toEth(settledWei),
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
      reserveAfterPendingExposureWei: reserveAfterQueueWei.toString(),
      reserveAfterPendingExposureEth: toEth(reserveAfterQueueWei),
      belowWarningThreshold: reserveAfterQueueWei < reserveWarningThresholdWei,
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
