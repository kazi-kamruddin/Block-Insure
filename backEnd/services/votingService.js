const VOTE_CODES = {
  VALID: 1,
  INVALID: 2,
  NEEDS_MORE: 3,
};

const VOTE_LABELS = {
  [VOTE_CODES.VALID]: "VALID",
  [VOTE_CODES.INVALID]: "INVALID",
  [VOTE_CODES.NEEDS_MORE]: "NEEDS_MORE",
};

const VOTE_DISPLAY_LABELS = {
  VALID: "Valid Claim",
  INVALID: "Invalid Claim",
  NEEDS_MORE: "Needs More Evidence",
};

const VOTE_ORDER = ["VALID", "INVALID", "NEEDS_MORE"];

const toNumber = (value) => {
  if (value === undefined || value === null || value === "") {
    return 0;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value.toString === "function") {
    return Number(value.toString());
  }

  return Number(value);
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const roundWeight = (value) => Number(value.toFixed(4));

const createEmptyBreakdown = () => {
  return Object.fromEntries(
    VOTE_ORDER.map((label) => [
      label,
      {
        vote: VOTE_CODES[label],
        label,
        displayLabel: VOTE_DISPLAY_LABELS[label],
        count: 0,
        weightedSum: 0,
      },
    ])
  );
};

const calculateWeightedConsensus = (voters = [], votes = [], reputations = []) => {
  const breakdown = createEmptyBreakdown();
  const voterDetails = [];
  let totalWeight = 0;

  voters.forEach((voter, index) => {
    const vote = toNumber(votes[index]);
    const voteLabel = VOTE_LABELS[vote];

    if (!voteLabel) {
      return;
    }

    const reputation = clamp(toNumber(reputations[index]), 0, 100);
    const weight = reputation / 100;

    breakdown[voteLabel].count += 1;
    breakdown[voteLabel].weightedSum += weight;
    totalWeight += weight;

    voterDetails.push({
      auditorAddress: String(voter),
      vote,
      voteLabel,
      voteDisplayLabel: VOTE_DISPLAY_LABELS[voteLabel],
      reputation,
      weight: roundWeight(weight),
    });
  });

  const weightedResults = Object.fromEntries(
    VOTE_ORDER.map((label) => [
      label,
      roundWeight(breakdown[label].weightedSum),
    ])
  );

  const maxWeight = Math.max(...Object.values(weightedResults));
  const winners =
    totalWeight > 0
      ? VOTE_ORDER.filter((label) => weightedResults[label] === maxWeight)
      : [];
  const isTie = winners.length > 1;
  const consensus = winners.length === 1 ? winners[0] : null;
  const consensusCode = consensus ? VOTE_CODES[consensus] : null;
  const consensusStrength =
    totalWeight > 0 ? roundWeight(maxWeight / totalWeight) : 0;

  Object.values(breakdown).forEach((entry) => {
    entry.weightedSum = roundWeight(entry.weightedSum);
    entry.percentage =
      voterDetails.length > 0
        ? roundWeight(entry.count / voterDetails.length)
        : 0;
  });

  return {
    consensus,
    consensusCode,
    consensusDisplayLabel: consensus
      ? VOTE_DISPLAY_LABELS[consensus]
      : isTie
        ? "Tie"
        : "No Consensus",
    consensusStrength,
    breakdown,
    totalVoters: voterDetails.length,
    totalWeight: roundWeight(totalWeight),
    weightedResults,
    voters: voterDetails,
    isTie,
  };
};

const calculateReputationUpdate = (auditorAddress, claimId, consensusResult) => {
  const normalizedAuditor = String(auditorAddress).toLowerCase();
  const voter = consensusResult.voters.find(
    (entry) => entry.auditorAddress.toLowerCase() === normalizedAuditor
  );

  if (!voter) {
    throw new Error("Auditor did not vote on this claim");
  }

  if (!consensusResult.consensusCode || consensusResult.isTie) {
    throw new Error("Cannot update reputation without a clear consensus");
  }

  const votedWithConsensus = voter.vote === consensusResult.consensusCode;
  const delta = votedWithConsensus ? 2 : -1;
  const newReputation = clamp(voter.reputation + delta, 0, 100);

  return {
    auditorAddress: voter.auditorAddress,
    claimId: claimId.toString(),
    vote: voter.vote,
    voteLabel: voter.voteLabel,
    voteDisplayLabel: voter.voteDisplayLabel,
    previousReputation: voter.reputation,
    delta,
    newReputation,
    votedWithConsensus,
  };
};

module.exports = {
  VOTE_CODES,
  VOTE_LABELS,
  VOTE_DISPLAY_LABELS,
  calculateWeightedConsensus,
  calculateReputationUpdate,
};
