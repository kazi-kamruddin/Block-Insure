const fs = require("fs/promises");
const path = require("path");
const OracleLog = require("../models/OracleLog");

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

module.exports = {
  getAuditorReputationAnalysis,
  getEvaluationSummary,
  getGasComparison,
  getRiskDistribution,
  getOracleStats,
  getThroughputResults,
};
