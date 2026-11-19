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

const Rationale = require("../models/ReviewRationale");
const { getDeploymentScope } = require("../services/deploymentScopeService");
const prepareVoteReason = async (req, res, next) => {
  try {
    const { vote, basis, version } = req.body;
    if (![1, 2].includes(vote) || !Number.isSafeInteger(version) || typeof basis !== "string" ||
        !basis.trim() || basis.length > 500) throw createError("A vote and a concise evidence-based reason are required", 422);
    const manager = getReadOnlyContract();
    const adjudicator = await getClaimAdjudicator(manager);
    const claimId = req.params.claimId;
    const auditor = req.user.walletAddress.toLowerCase();
    if (Number(await manager.claimVersion(claimId)) !== version || !await adjudicator.isAssigned(claimId, version, auditor))
      throw createError("Current reviewer assignment required", 403);
    const review = await adjudicator.getReview(claimId, version);
    if (!review.deadline || review.finalized || Number(await adjudicator.getVote(claimId, version, auditor)))
      throw createError("Review is unavailable for this vote", 409);
    const scope = await getDeploymentScope(manager.runner.provider);
    const nonce = ethers.hexlify(ethers.randomBytes(32));
    const commitment = ethers.id(JSON.stringify([scope, claimId, version, auditor, vote, basis.trim(), nonce]));
    await Rationale.create({ scope, claimId, version, auditor, vote, basis: basis.trim(), nonce, commitment });
    res.status(201).json({ commitment });
  } catch (error) { next(error); }
};

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
    let reasonedVoting = false;
    if (typeof adjudicator.reasonedVotingRequired === "function") {
      try { reasonedVoting = await adjudicator.reasonedVotingRequired(); }
      catch (error) { if (error.code !== "CALL_EXCEPTION") throw error; }
    }
    const votes = Array.from(rawVotes.reviewVotes || rawVotes[1] || []);

    if (
      req.user.role === "AUDITOR" &&
      !assigned.some(
        (address) => address.toLowerCase() === req.user.walletAddress.toLowerCase()
      )
    ) {
      throw createError("Access denied: auditor is not assigned to this review", 403);
    }

    if (req.user.role === "AUDITOR" && !review.finalized) {
      const index = assigned.findIndex(address => address.toLowerCase() === req.user.walletAddress.toLowerCase());
      if (Number(votes[index]) === 0) {
        return res.set("Cache-Control", "private, no-store").json({ success: true, voteSummary: {
          claimId: String(claimId), version: Number(version), reasonedVoting, peerVotesHidden: true, hasCurrentUserVoted: false,
          finalized: false, assignedAuditors: assigned, minimumVoters: 4, deadline: Number(review.deadline),
        } });
      }
    }
    const reputations = await Promise.all(
      assigned.map((address) => adjudicator.auditorReputation(address))
    );
    const consensus = calculateWeightedConsensus(assigned, votes, reputations);
    const currentWallet = String(
      req.user.walletAddress || ""
    ).toLowerCase();
    const currentUserVote = consensus.voters.find(
      (voter) => voter.auditorAddress.toLowerCase() === currentWallet
    );

    const rationales = new Map();
    if (reasonedVoting && consensus.voters.length) {
      const key = await adjudicator.reviewKey(claimId, version);
      const commitments = await Promise.all(consensus.voters.map(voter => adjudicator.voteReason(key, voter.auditorAddress)));
      const records = await Rationale.find({ commitment: { $in: commitments }, scope: await getDeploymentScope(manager.runner.provider) }).lean();
      for (const row of records) {
        if (row.commitment === ethers.id(JSON.stringify([row.scope, row.claimId, row.version, row.auditor, row.vote, row.basis, row.nonce]))) rationales.set(row.auditor, row.basis);
      }
    }
    res.set("Cache-Control", "private, no-store").status(200).json({
      success: true,
      voteSummary: {
        authority: "ON_CHAIN_UNWEIGHTED_QUORUM",
        weightedSummaryIsAdvisory: true,
        reputationMeaning: "Agreement with finalized quorum outcomes, not independently established claim truth; timeouts are not merits observations",
        claimId: String(claimId),
        ...consensus, version: Number(version), reasonedVoting,
        voters: consensus.voters.map((voter) => ({
          ...voter, rationale: rationales.get(voter.auditorAddress.toLowerCase()),
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

module.exports = { getClaimVoteSummary, prepareVoteReason };
