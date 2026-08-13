const { ethers } = require("ethers");
const {
  getClaimAdjudicator,
  getReadOnlyContract,
} = require("../services/contractService");
const { calculateWeightedConsensus } = require("../services/votingService");

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const shortenAddress = (address) =>
  address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";

const getClaimVoteSummary = async (req, res, next) => {
  try {
    const { claimId } = req.params;
    if (!claimId) throw createError("claimId is required", 400);

    const manager = getReadOnlyContract();
    const adjudicator = await getClaimAdjudicator(manager);
    const version = await manager.claimVersion(claimId);
    const [rawVotes, review] = await Promise.all([
      adjudicator.getVotes(claimId, version),
      adjudicator.getReview(claimId, version),
    ]);
    const assigned = Array.from(rawVotes.auditors || rawVotes[0] || []).filter(
      (address) => address !== ethers.ZeroAddress
    );
    const votes = Array.from(rawVotes.reviewVotes || rawVotes[1] || []);

    if (
      req.user.role === "AUDITOR" &&
      !assigned.some(
        (address) => address.toLowerCase() === req.user.walletAddress.toLowerCase()
      )
    ) {
      throw createError("Access denied: auditor is not assigned to this review", 403);
    }

    const reputations = await Promise.all(
      assigned.map((address) => adjudicator.auditorReputation(address))
    );
    const consensus = calculateWeightedConsensus(assigned, votes, reputations);
    const currentWallet = String(
      req.query.voterAddress || req.user.walletAddress || ""
    ).toLowerCase();
    const currentUserVote = consensus.voters.find(
      (voter) => voter.auditorAddress.toLowerCase() === currentWallet
    );

    res.status(200).json({
      success: true,
      voteSummary: {
        claimId: String(claimId),
        ...consensus,
        voters: consensus.voters.map((voter) => ({
          ...voter,
          shortenedAddress: shortenAddress(voter.auditorAddress),
        })),
        assignedAuditors: assigned,
        approvals: Number(review.approvals),
        rejections: Number(review.rejections),
        deadline: Number(review.deadline),
        minimumVoters: 4,
        quorumReached: Boolean(review.finalized),
        finalized: Boolean(review.finalized),
        approved: Boolean(review.approved),
        hasCurrentUserVoted: Boolean(currentUserVote),
        currentUserVote: currentUserVote || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getClaimVoteSummary };
