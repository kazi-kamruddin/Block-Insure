const {
  getAdminContract,
  getReadOnlyContract,
} = require("../services/contractService");
const {
  calculateReputationUpdate,
  calculateWeightedConsensus,
} = require("../services/votingService");

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const shortenAddress = (address) => {
  if (!address) return "";

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

const formatVoteSummary = (claimId, rawVotes, currentWalletAddress = "") => {
  const voters = Array.from(rawVotes.voters || rawVotes[0] || []);
  const votes = Array.from(rawVotes.votes || rawVotes[1] || []);
  const reputations = Array.from(rawVotes.reputations || rawVotes[2] || []);
  const consensusResult = calculateWeightedConsensus(voters, votes, reputations);
  const normalizedCurrentWallet = currentWalletAddress.toLowerCase();

  const formattedVoters = consensusResult.voters.map((voter) => ({
    ...voter,
    shortenedAddress: shortenAddress(voter.auditorAddress),
  }));

  const currentUserVote =
    formattedVoters.find(
      (voter) => voter.auditorAddress.toLowerCase() === normalizedCurrentWallet
    ) || null;

  return {
    claimId: claimId.toString(),
    ...consensusResult,
    voters: formattedVoters,
    hasCurrentUserVoted: Boolean(currentUserVote),
    currentUserVote: currentUserVote
      ? {
          vote: currentUserVote.vote,
          voteLabel: currentUserVote.voteLabel,
          voteDisplayLabel: currentUserVote.voteDisplayLabel,
        }
      : null,
  };
};

const getClaimVoteSummary = async (req, res, next) => {
  try {
    const { claimId } = req.params;

    if (!claimId) {
      throw createError("claimId is required", 400);
    }

    const contract = getReadOnlyContract();
    const rawVotes = await contract.getClaimVotes(claimId);
    const voteSummary = formatVoteSummary(
      claimId,
      rawVotes,
      req.user.walletAddress
    );

    res.status(200).json({
      success: true,
      voteSummary,
    });
  } catch (error) {
    next(error);
  }
};

const finalizeVoting = async (req, res, next) => {
  try {
    const { claimId } = req.params;

    if (!claimId) {
      throw createError("claimId is required", 400);
    }

    const contract = getAdminContract();
    const rawVotes = await contract.getClaimVotes(claimId);
    const voteSummary = formatVoteSummary(
      claimId,
      rawVotes,
      req.user.walletAddress
    );

    if (voteSummary.totalVoters === 0) {
      throw createError("No auditor votes found for this claim", 400);
    }

    if (!voteSummary.consensusCode || voteSummary.isTie) {
      throw createError(
        "Voting cannot be finalized until there is a clear weighted consensus",
        400
      );
    }

    const reputationChanges = [];
    const transactionHashes = [];

    for (const voter of voteSummary.voters) {
      const reputationChange = calculateReputationUpdate(
        voter.auditorAddress,
        claimId,
        voteSummary
      );

      const tx = await contract.updateAuditorReputation(
        reputationChange.auditorAddress,
        reputationChange.newReputation
      );
      const receipt = await tx.wait();

      reputationChanges.push({
        ...reputationChange,
        transactionHash: tx.hash,
        blockNumber: receipt.blockNumber,
      });
      transactionHashes.push(tx.hash);
    }

    res.status(200).json({
      success: true,
      message: "Voting finalized and auditor reputations updated",
      consensusResult: {
        consensus: voteSummary.consensus,
        consensusCode: voteSummary.consensusCode,
        consensusDisplayLabel: voteSummary.consensusDisplayLabel,
        consensusStrength: voteSummary.consensusStrength,
        weightedResults: voteSummary.weightedResults,
        totalVoters: voteSummary.totalVoters,
      },
      reputationChanges,
      transactionHashes,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getClaimVoteSummary,
  finalizeVoting,
};
