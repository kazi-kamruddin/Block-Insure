require("dotenv").config();

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const VotingFinalization = require("../models/VotingFinalization");
const { getReadOnlyContract } = require("../services/contractService");
const { writeCsv } = require("./evaluateRiskModel");

const RESULTS_DIR = path.join(__dirname, "..", "evaluation-results");

const round = (value, decimals = 4) => {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(decimals));
};

const calculatePearsonCorrelation = (pairs) => {
  if (pairs.length < 2) return null;

  const xMean = pairs.reduce((total, pair) => total + pair.x, 0) / pairs.length;
  const yMean = pairs.reduce((total, pair) => total + pair.y, 0) / pairs.length;
  const numerator = pairs.reduce(
    (total, pair) => total + (pair.x - xMean) * (pair.y - yMean),
    0
  );
  const xSpread = Math.sqrt(
    pairs.reduce((total, pair) => total + (pair.x - xMean) ** 2, 0)
  );
  const ySpread = Math.sqrt(
    pairs.reduce((total, pair) => total + (pair.y - yMean) ** 2, 0)
  );

  if (xSpread === 0 || ySpread === 0) return null;
  return round(numerator / (xSpread * ySpread), 6);
};

const interpretCorrelation = (correlation) => {
  if (correlation === null) return "Insufficient variation or sample size";
  if (correlation >= 0.7) return "Strong positive relationship";
  if (correlation >= 0.3) return "Moderate positive relationship";
  if (correlation > -0.3) return "Weak or negligible relationship";
  if (correlation > -0.7) return "Moderate negative relationship";
  return "Strong negative relationship";
};

const analyzeFinalizations = async (finalizations, getReputation) => {
  const auditors = new Map();

  finalizations.forEach((finalization) => {
    finalization.voters.forEach((voter) => {
      const wallet = voter.auditorAddress.toLowerCase();
      const current = auditors.get(wallet) || {
        wallet,
        votesAnalyzed: 0,
        consensusAlignedVotes: 0,
        consensusOpposedVotes: 0,
      };

      current.votesAnalyzed += 1;

      if (voter.votedWithConsensus) {
        current.consensusAlignedVotes += 1;
      } else {
        current.consensusOpposedVotes += 1;
      }

      auditors.set(wallet, current);
    });
  });

  const rows = [];

  for (const auditor of auditors.values()) {
    const reputationScore = await getReputation(auditor.wallet);

    rows.push({
      ...auditor,
      reputationScore,
      historicalAccuracy: round(
        auditor.consensusAlignedVotes / auditor.votesAnalyzed,
        6
      ),
    });
  }

  rows.sort((left, right) => right.reputationScore - left.reputationScore);

  const correlation = calculatePearsonCorrelation(
    rows.map((row) => ({ x: row.reputationScore, y: row.historicalAccuracy }))
  );

  return {
    generatedAt: new Date().toISOString(),
    methodology:
      "Auditor vote accuracy is measured against the clear weighted consensus persisted when voting was finalized.",
    finalizedClaimsAnalyzed: finalizations.length,
    auditorsAnalyzed: rows.length,
    pearsonCorrelation: correlation,
    interpretation: interpretCorrelation(correlation),
    auditors: rows,
  };
};

const runAnalysis = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing in .env");
  }

  await mongoose.connect(process.env.MONGODB_URI);

  try {
    const finalizations = await VotingFinalization.find().lean();

    if (finalizations.length === 0) {
      throw new Error("No finalized voting sessions found. Finalize demo votes first.");
    }

    const contract = getReadOnlyContract();
    const analysis = await analyzeFinalizations(finalizations, async (wallet) => {
      return Number(await contract.auditorReputation(wallet));
    });

    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(RESULTS_DIR, "auditor-reputation-analysis.json"),
      `${JSON.stringify(analysis, null, 2)}\n`,
      "utf8"
    );
    writeCsv(
      path.join(RESULTS_DIR, "auditor-reputation-analysis.csv"),
      analysis.auditors
    );

    console.log("Auditor reputation analysis completed");
    console.log(`Finalized claims analyzed: ${analysis.finalizedClaimsAnalyzed}`);
    console.log(`Auditors analyzed: ${analysis.auditorsAnalyzed}`);
    console.log(`Pearson correlation: ${analysis.pearsonCorrelation ?? "N/A"}`);
    console.log(`Interpretation: ${analysis.interpretation}`);

    return analysis;
  } finally {
    await mongoose.connection.close();
  }
};

if (require.main === module) {
  runAnalysis().catch(async (error) => {
    console.error("Auditor reputation analysis failed:", error.message);
    await mongoose.connection.close();
    process.exit(1);
  });
}

module.exports = {
  analyzeFinalizations,
  calculatePearsonCorrelation,
  interpretCorrelation,
  runAnalysis,
};
