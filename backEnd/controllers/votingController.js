const {
  getAdminContract,
  getReadOnlyContract,
} = require("../services/contractService");
const { ethers } = require("ethers");
const {
  calculateReputationUpdate,
  calculateWeightedConsensus,
} = require("../services/votingService");
const VotingFinalization = require("../models/VotingFinalization");
const { logAdminAction } = require("../services/adminActionLogService");

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
    const voterAddress = String(req.query.voterAddress || "").trim();

    if (!claimId) {
      throw createError("claimId is required", 400);
    }

    const contract = getReadOnlyContract();
    const rawVotes = await contract.getClaimVotes(claimId);
    const currentWalletAddress = ethers.isAddress(voterAddress)
      ? voterAddress
      : req.user.walletAddress;
    const voteSummary = formatVoteSummary(
      claimId,
      rawVotes,
      currentWalletAddress
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

    const existingFinalization = await VotingFinalization.findOne({
      claimId: claimId.toString(),
    })
      .select("_id")
      .lean();

    if (existingFinalization) {
      throw createError("Voting has already been finalized for this claim", 409);
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
    let nextNonce = await contract.runner.getNonce("pending");

    for (const voter of voteSummary.voters) {
      const reputationChange = calculateReputationUpdate(
        voter.auditorAddress,
        claimId,
        voteSummary
      );

      const tx = await contract.updateAuditorReputation(
        reputationChange.auditorAddress,
        reputationChange.newReputation,
        { nonce: nextNonce }
      );
      nextNonce += 1;
      const receipt = await tx.wait();

      reputationChanges.push({
        ...reputationChange,
        transactionHash: tx.hash,
        blockNumber: receipt.blockNumber,
      });
      transactionHashes.push(tx.hash);
    }

    await VotingFinalization.findOneAndUpdate(
      { claimId: claimId.toString() },
      {
        claimId: claimId.toString(),
        consensus: voteSummary.consensus,
        consensusCode: voteSummary.consensusCode,
        consensusStrength: voteSummary.consensusStrength,
        totalVoters: voteSummary.totalVoters,
        voters: voteSummary.voters.map((voter) => ({
          auditorAddress: voter.auditorAddress,
          vote: voter.vote,
          voteLabel: voter.voteLabel,
          reputationAtFinalization: voter.reputation,
          votedWithConsensus: voter.vote === voteSummary.consensusCode,
        })),
        reputationTransactionHashes: transactionHashes,
        finalizedBy: req.user.walletAddress,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await logAdminAction({
      req,
      action: "FINALIZE_VOTING",
      targetType: "CLAIM",
      targetId: claimId,
      tx: { hash: transactionHashes[transactionHashes.length - 1] || "" },
      receipt: reputationChanges[reputationChanges.length - 1] || null,
      metadata: {
        consensus: voteSummary.consensus,
        consensusCode: voteSummary.consensusCode,
        consensusStrength: voteSummary.consensusStrength,
        totalVoters: voteSummary.totalVoters,
        transactionHashes,
        reputationChanges,
      },
    });

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
