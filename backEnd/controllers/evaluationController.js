const fs = require("fs/promises");
const path = require("path");
const { ethers } = require("ethers");
const OracleLog = require("../models/OracleLog");
const User = require("../models/User");
const VotingFinalization = require("../models/VotingFinalization");
const {
  getContractBalance,
  getRegistrySnapshot,
  getReadOnlyContract,
} = require("../services/contractService");
const { getPolicyPackageIds } = require("../services/contractQueryService");

const backendRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(backendRoot, "..");

const EVALUATION_RESULTS_DIR = path.join(backendRoot, "evaluation-results");
const LEGACY_SCRIPTS_DIR = path.join(backendRoot, "scripts");
const GAS_RESULTS_PATH = path.join(projectRoot, "contracts", "gas-comparison-results.csv");
const THROUGHPUT_RESULTS_PATH = path.join(
  EVALUATION_RESULTS_DIR,
  "claim-throughput-results.json"
);
const AUDITOR_ANALYSIS_PATH = path.join(
  EVALUATION_RESULTS_DIR,
  "auditor-reputation-analysis.json"
);

const CLAIM_STATUS = [
  "SUBMITTED",
  "DUPLICATE_CHECKED",
  "FRAUD_FLAGGED",
  "ORACLE_PENDING",
  "ORACLE_VERIFIED",
  "ORACLE_FAILED",
  "MANUAL_REVIEW",
  "PAYOUT_READY",
  "REJECTED",
  "SETTLED",
  "CLOSED",
  "FUNDING_REQUIRED",
  "APPEALED",
];

const POLICY_STATUS = [
  "PENDING_PAYMENT",
  "ACTIVE",
  "GRACE_PERIOD",
  "LAPSED",
  "CANCELLED",
  "EXPIRED",
  "RENEWED",
];

const parseCsvLine = (line) => {
  const values = [];
  let currentValue = "";
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && insideQuotes && nextChar === '"') {
      currentValue += '"';
      index += 1;
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === "," && !insideQuotes) {
      values.push(currentValue);
      currentValue = "";
    } else {
      currentValue += char;
    }
  }

  values.push(currentValue);
  return values;
};

const parseCsv = (csvText) => {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};

    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });

    return row;
  });
};

const normalizeNumber = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
};

const readFirstExistingFile = async (paths) => {
  for (const filePath of paths) {
    try {
      return {
        filePath,
        contents: await fs.readFile(filePath, "utf8"),
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  return null;
};

const getEvaluationSummary = async (req, res, next) => {
  try {
    const result = await readFirstExistingFile([
      path.join(EVALUATION_RESULTS_DIR, "risk-model-summary.json"),
      path.join(LEGACY_SCRIPTS_DIR, "risk-model-summary.json"),
    ]);

    if (!result) {
      return res.status(200).json({
        success: false,
        error: "Run npm run evaluate:risk first",
      });
    }

    res.status(200).json({
      success: true,
      summary: JSON.parse(result.contents),
      sourceFile: path.relative(projectRoot, result.filePath),
    });
  } catch (error) {
    next(error);
  }
};

const getGasComparison = async (req, res, next) => {
  try {
    let csvText;

    try {
      csvText = await fs.readFile(GAS_RESULTS_PATH, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }

      return res.status(200).json({
        success: false,
        error: "Run npm run gas:compare first",
      });
    }

    const rows = parseCsv(csvText).map((row) => ({
      records: normalizeNumber(row.records),
      individual_gas: normalizeNumber(row.individual_gas),
      merkle_gas: normalizeNumber(row.merkle_gas),
      gas_saved: normalizeNumber(row.gas_saved),
      savings_percent: normalizeNumber(row.savings_percent),
    }));

    res.status(200).json({
      success: true,
      rows,
      sourceFile: path.relative(projectRoot, GAS_RESULTS_PATH),
    });
  } catch (error) {
    next(error);
  }
};

const getRiskDistribution = async (req, res, next) => {
  try {
    const result = await readFirstExistingFile([
      path.join(EVALUATION_RESULTS_DIR, "risk-model-records.csv"),
      path.join(LEGACY_SCRIPTS_DIR, "risk-model-records.csv"),
    ]);

    if (!result) {
      return res.status(200).json({
        success: false,
        error: "Run npm run evaluate:risk first",
      });
    }

    const buckets = [
      { range: "0-20", min: 0, max: 20, count: 0, label: "LOW" },
      { range: "21-40", min: 21, max: 40, count: 0, label: "LOW-MEDIUM" },
      { range: "41-60", min: 41, max: 60, count: 0, label: "MEDIUM" },
      { range: "61-80", min: 61, max: 80, count: 0, label: "HIGH" },
      { range: "81-100", min: 81, max: 100, count: 0, label: "CRITICAL" },
    ];

    parseCsv(result.contents).forEach((row) => {
      const riskScore = normalizeNumber(row.riskScore);
      const bucket = buckets.find(
        (item) => riskScore >= item.min && riskScore <= item.max
      );

      if (bucket) {
        bucket.count += 1;
      }
    });

    res.status(200).json({
      success: true,
      buckets: buckets.map(({ range, count, label }) => ({
        range,
        count,
        label,
      })),
      sourceFile: path.relative(projectRoot, result.filePath),
    });
  } catch (error) {
    next(error);
  }
};

const getOracleStats = async (req, res, next) => {
  try {
    const logs = await OracleLog.find({}).lean();
    const verifiedCount = logs.filter((log) => log.verified === true).length;
    const failedCount = logs.filter((log) => log.verified === false).length;
    const responseTimes = logs
      .map((log) => log.responseTimeMs)
      .filter((responseTimeMs) => Number.isFinite(responseTimeMs) && responseTimeMs >= 0);
    const averageResponseTimeMs =
      responseTimes.length > 0
        ? Math.round(
            responseTimes.reduce((total, responseTimeMs) => total + responseTimeMs, 0) /
              responseTimes.length
          )
        : null;
    const riskLevelCounts = {};

    logs.forEach((log) => {
      const riskLevel = log.riskLevel || "UNKNOWN";
      riskLevelCounts[riskLevel] = (riskLevelCounts[riskLevel] || 0) + 1;
    });

    const mostCommonRiskLevels = Object.entries(riskLevelCounts)
      .map(([riskLevel, count]) => ({ riskLevel, count }))
      .sort((a, b) => b.count - a.count || a.riskLevel.localeCompare(b.riskLevel));

    res.status(200).json({
      success: true,
      oracleStats: {
        totalVerifications: logs.length,
        verifiedCount,
        failedCount,
        averageResponseTimeMs,
        mostCommonRiskLevels,
        riskLevelCounts,
      },
    });
  } catch (error) {
    next(error);
  }
};

const getJsonEvaluationArtifact = async ({
  res,
  filePath,
  responseKey,
  missingMessage,
}) => {
  try {
    const contents = await fs.readFile(filePath, "utf8");

    res.status(200).json({
      success: true,
      [responseKey]: JSON.parse(contents),
      sourceFile: path.relative(projectRoot, filePath),
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      return res.status(200).json({
        success: false,
        error: missingMessage,
      });
    }

    throw error;
  }
};

const getThroughputResults = async (req, res, next) => {
  try {
    await getJsonEvaluationArtifact({
      res,
      filePath: THROUGHPUT_RESULTS_PATH,
      responseKey: "throughputResults",
      missingMessage: "Run npm run loadtest:claims first",
    });
  } catch (error) {
    next(error);
  }
};

const getAuditorReputationAnalysis = async (req, res, next) => {
  try {
    await getJsonEvaluationArtifact({
      res,
      filePath: AUDITOR_ANALYSIS_PATH,
      responseKey: "auditorAnalysis",
      missingMessage: "Run npm run analyze:auditors after finalizing demo votes",
    });
  } catch (error) {
    next(error);
  }
};

const increment = (target, key) => {
  const safeKey = key || "UNKNOWN";
  target[safeKey] = (target[safeKey] || 0) + 1;
};

const safeReadJson = async (filePath) => {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
};

const getDefenseSummary = async (req, res, next) => {
  try {
    const contract = getReadOnlyContract();
    const warnings = [];
    const [
      packageIds,
      nextPolicyId,
      nextClaimId,
      oracleLogs,
      votingFinalizations,
      contractBalance,
      registrySnapshot,
      modelSummary,
    ] = await Promise.all([
      getPolicyPackageIds(contract).catch((error) => {
        warnings.push(`Policy package read failed: ${error.message}`);
        return [];
      }),
      contract.policyCounter().catch(() => 1n),
      contract.claimCounter().catch(() => 1n),
      OracleLog.find({}).lean().catch(() => []),
      VotingFinalization.find({}).lean().catch(() => []),
      getContractBalance().catch(() => null),
      getRegistrySnapshot(contract).catch(() => null),
      safeReadJson(path.join(EVALUATION_RESULTS_DIR, "risk-model-summary.json")),
    ]);

    const packages = await Promise.all(
      packageIds.map(async (packageId) => contract.getPolicyPackage(packageId))
    );
    const policyStatusCounts = Object.fromEntries(
      POLICY_STATUS.map((status) => [status, 0])
    );
    const claimStateDistribution = Object.fromEntries(
      CLAIM_STATUS.map((status) => [status, 0])
    );
    const policies = [];
    let totalPremiumsCollectedWei = 0n;
    let overduePolicyCount = 0;

    for (let policyId = 1; policyId < Number(nextPolicyId); policyId += 1) {
      try {
        const [policy, effectiveStatus] = await Promise.all([
          contract.getPolicy(policyId),
          contract.getEffectivePolicyStatus(policyId),
        ]);
        const statusLabel = POLICY_STATUS[Number(effectiveStatus)] || "UNKNOWN";
        const totalPaid = policy.totalPremiumPaid || policy.premiumPaid || 0n;

        increment(policyStatusCounts, statusLabel);
        totalPremiumsCollectedWei += totalPaid;

        if (statusLabel === "GRACE_PERIOD" || statusLabel === "LAPSED") {
          overduePolicyCount += 1;
        }

        policies.push({
          policyId: policy.policyId.toString(),
          status: statusLabel,
          totalPremiumPaidWei: totalPaid.toString(),
        });
      } catch (error) {
        warnings.push(`Policy #${policyId} skipped: ${error.message}`);
      }
    }

    let fraudFlaggedCount = 0;
    let settlementTotalWei = 0n;
    let settledClaimCount = 0;

    for (let claimId = 1; claimId < Number(nextClaimId); claimId += 1) {
      try {
        const claim = await contract.getClaim(claimId);
        const statusLabel = CLAIM_STATUS[Number(claim.status)] || "UNKNOWN";

        increment(claimStateDistribution, statusLabel);

        if (statusLabel === "FRAUD_FLAGGED") {
          fraudFlaggedCount += 1;
        }

        if (statusLabel === "SETTLED" || statusLabel === "CLOSED") {
          try {
            const settlement = await contract.getSettlementRecord(claimId);
            settlementTotalWei += settlement.amount;
            settledClaimCount += 1;
          } catch {
            warnings.push(`Settlement data missing for claim #${claimId}`);
          }
        }
      } catch (error) {
        warnings.push(`Claim #${claimId} skipped: ${error.message}`);
      }
    }

    const oraclePendingCount = claimStateDistribution.ORACLE_PENDING || 0;
    const oracleSuccessCount = oracleLogs.filter((log) => log.verified === true).length;
    const oracleFailureCount = oracleLogs.filter((log) => log.verified === false).length;
    const root = registrySnapshot?.root || registrySnapshot?.[0] || ethers.ZeroHash;
    const registryTimestamp = registrySnapshot?.timestamp || registrySnapshot?.[1] || 0n;
    const usersByRole = await User.aggregate([
      { $group: { _id: "$role", count: { $sum: 1 } } },
    ]).catch(() => []);

    const demoReadiness = {
      hasActivePackage: packages.some((policyPackage) => policyPackage.isActive),
      hasPurchasedPolicy: policies.length > 0,
      hasClaims: Number(nextClaimId) > 1,
      hasOracleLogs: oracleLogs.length > 0,
      hasVotingReadyClaim:
        (claimStateDistribution.ORACLE_FAILED || 0) +
          (claimStateDistribution.MANUAL_REVIEW || 0) >
        0,
      hasSettlement: settledClaimCount > 0,
      warnings,
    };

    res.status(200).json({
      success: true,
      defenseSummary: {
        generatedAt: new Date().toISOString(),
        policyPackages: {
          total: packages.length,
          active: packages.filter((policyPackage) => policyPackage.isActive).length,
        },
        policies: {
          totalPurchased: policies.length,
          statusCounts: policyStatusCounts,
          totalPremiumsCollectedWei: totalPremiumsCollectedWei.toString(),
          totalPremiumsCollectedEth: ethers.formatEther(totalPremiumsCollectedWei),
          overduePolicyCount,
        },
        claims: {
          total: Number(nextClaimId) - 1,
          stateDistribution: claimStateDistribution,
          fraudFlaggedCount,
        },
        oracle: {
          pending: oraclePendingCount,
          success: oracleSuccessCount,
          failure: oracleFailureCount,
          totalLogs: oracleLogs.length,
        },
        auditors: {
          finalizedVotes: votingFinalizations.length,
          totalVoters: votingFinalizations.reduce(
            (total, finalization) => total + (finalization.voters?.length || 0),
            0
          ),
        },
        settlements: {
          settledClaimCount,
          totalWei: settlementTotalWei.toString(),
          totalEth: ethers.formatEther(settlementTotalWei),
        },
        contract: {
          reserveWei: contractBalance?.toString?.() || null,
          reserveEth: contractBalance ? ethers.formatEther(contractBalance) : null,
        },
        registry: {
          root,
          committed: root !== ethers.ZeroHash && Number(registryTimestamp) > 0,
          timestamp: registryTimestamp?.toString?.() || "0",
          blockNumber: (registrySnapshot?.blockNumber || registrySnapshot?.[2] || 0n).toString(),
        },
        modelEvaluation: modelSummary
          ? {
              metrics: modelSummary.metrics || null,
              decisionRule: modelSummary.decisionRule || null,
              dataset: modelSummary.dataset || null,
            }
          : null,
        demoReadiness,
        usersByRole: Object.fromEntries(
          usersByRole.map((entry) => [entry._id || "UNKNOWN", entry.count])
        ),
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAuditorReputationAnalysis,
  getDefenseSummary,
  getEvaluationSummary,
  getGasComparison,
  getRiskDistribution,
  getOracleStats,
  getThroughputResults,
};
