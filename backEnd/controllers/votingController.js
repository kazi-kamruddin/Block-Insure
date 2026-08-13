const {
  getAdminContract,
  getReadOnlyContract,
} = require("../services/contractService");
const { ethers } = require("ethers");
const {
  VOTE_CODES,
  calculateReputationUpdate,
  calculateWeightedConsensus,
} = require("../services/votingService");
const VotingFinalization = require("../models/VotingFinalization");
const { logAdminAction } = require("../services/adminActionLogService");
const MINIMUM_AUDITOR_VOTES = Math.max(
  2,
  Number(process.env.MINIMUM_AUDITOR_VOTES || 2)
);

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const shortenAddress = (address) => {
  if (!address) return "";

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

const formatVoteSummary = (
  claimId,
  rawVotes,
  currentWalletAddress = "",
  finalization = null
) => {
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
    minimumVoters: MINIMUM_AUDITOR_VOTES,
    quorumReached: formattedVoters.length >= MINIMUM_AUDITOR_VOTES,
    finalized: finalization?.status === "COMPLETED",
    finalization: finalization
      ? {
          status: finalization.status,
          consensus: finalization.consensus,
          consensusCode: finalization.consensusCode,
          consensusStrength: finalization.consensusStrength,
          totalVoters: finalization.totalVoters,
          finalizedBy: finalization.finalizedBy,
          finalizedAt: finalization.updatedAt,
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
    const finalization = await VotingFinalization.findOne({
      claimId: claimId.toString(),
    });
    const voteSummary = formatVoteSummary(
      claimId,
      rawVotes,
      currentWalletAddress,
      finalization
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
  let finalizationId = null;

  try {
    const { claimId } = req.params;

    if (!claimId) {
      throw createError("claimId is required", 400);
    }

    const existingFinalization = await VotingFinalization.findOne({
      claimId: claimId.toString(),
    });

    if (existingFinalization?.status === "COMPLETED") {
      return res.status(200).json({
        success: true,
        idempotent: true,
        message: "Voting was already finalized",
        consensusResult: {
          consensus: existingFinalization.consensus,
          consensusCode: existingFinalization.consensusCode,
          consensusStrength: existingFinalization.consensusStrength,
          totalVoters: existingFinalization.totalVoters,
        },
        reputationChanges: existingFinalization.reputationChanges,
        transactionHashes: existingFinalization.reputationTransactionHashes,
      });
    }

    const contract = getAdminContract();
    let finalization = existingFinalization;
    let voteSummary;
    let createdFinalization = false;

    if (!finalization) {
      const rawVotes = await contract.getClaimVotes(claimId);
      voteSummary = formatVoteSummary(
        claimId,
        rawVotes,
        req.user.walletAddress
      );

      if (voteSummary.totalVoters === 0) {
        throw createError("No auditor votes found for this claim", 400);
      }

      if (voteSummary.totalVoters < MINIMUM_AUDITOR_VOTES) {
        throw createError(
          `At least ${MINIMUM_AUDITOR_VOTES} auditor votes are required`,
          400
        );
      }

      if (!voteSummary.consensusCode || voteSummary.isTie) {
        throw createError(
          "Voting cannot be finalized until there is a clear weighted consensus",
          400
        );
      }

      if (voteSummary.consensusCode === VOTE_CODES.NEEDS_MORE) {
        throw createError(
          "Auditor consensus requests more evidence. Keep voting open until additional evidence and votes produce a claim decision.",
          409
        );
      }

      const plannedChanges = voteSummary.voters.map((voter) => ({
        ...calculateReputationUpdate(
          voter.auditorAddress,
          claimId,
          voteSummary
        ),
        applied: false,
        transactionHash: "",
        blockNumber: null,
      }));

      try {
        finalization = await VotingFinalization.create({
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
          reputationChanges: plannedChanges,
          reputationTransactionHashes: [],
          finalizedBy: req.user.walletAddress,
          status: "PROCESSING",
          lockExpiresAt: new Date(Date.now() + 2 * 60 * 1000),
        });
        createdFinalization = true;
      } catch (error) {
        if (error.code !== 11000) throw error;
        finalization = await VotingFinalization.findOne({
          claimId: claimId.toString(),
        });
      }
    }

    if (!finalization) {
      throw createError("Could not create voting finalization", 500);
    }

    const now = new Date();

    if (
      !createdFinalization &&
      finalization.status === "PROCESSING" &&
      finalization.lockExpiresAt > now
    ) {
      throw createError("Another voting finalization is in progress", 409);
    }

    if (!createdFinalization) {
      finalization = await VotingFinalization.findOneAndUpdate(
        {
          _id: finalization._id,
          status: { $ne: "COMPLETED" },
          $or: [
            { status: { $ne: "PROCESSING" } },
            { lockExpiresAt: { $lte: now } },
          ],
        },
        {
          $set: {
            status: "PROCESSING",
            finalizedBy: req.user.walletAddress,
            lockExpiresAt: new Date(Date.now() + 2 * 60 * 1000),
            failureReason: "",
          },
        },
        { new: true }
      );
    }

    if (!finalization) {
      throw createError("Another voting finalization is in progress", 409);
    }

    finalizationId = finalization._id;
    const transactionHashes = [...finalization.reputationTransactionHashes];
    let nextNonce = await contract.runner.getNonce("pending");

    for (let index = 0; index < finalization.reputationChanges.length; index += 1) {
      const change = finalization.reputationChanges[index];

      if (change.applied) continue;

      const voterOutcome = finalization.voters.find(
        (voter) =>
          voter.auditorAddress.toLowerCase() ===
          change.auditorAddress.toLowerCase()
      );
      const observationId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "address"],
          [claimId, change.auditorAddress]
        )
      );
      const groundTruthHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "uint8"],
          [claimId, finalization.consensusCode]
        )
      );
      let transactionHash = change.transactionHash || "";
      let blockNumber = change.blockNumber || null;

      if (!(await contract.auditorOutcomeRecorded(observationId))) {
        const tx = await contract.recordAuditorOutcome(
          observationId,
          change.auditorAddress,
          Boolean(voterOutcome?.votedWithConsensus),
          groundTruthHash,
          { nonce: nextNonce }
        );
        nextNonce += 1;
        const receipt = await tx.wait();
        transactionHash = tx.hash;
        blockNumber = receipt.blockNumber;
        transactionHashes.push(tx.hash);
      }

      const derivedReputation = Number(
        await contract.auditorReputation(change.auditorAddress)
      );

      await VotingFinalization.updateOne(
        { _id: finalization._id },
        {
          $set: {
            [`reputationChanges.${index}.applied`]: true,
            [`reputationChanges.${index}.newReputation`]: derivedReputation,
            [`reputationChanges.${index}.delta`]:
              derivedReputation - Number(change.previousReputation || 0),
            [`reputationChanges.${index}.transactionHash`]: transactionHash,
            [`reputationChanges.${index}.blockNumber`]: blockNumber,
            lockExpiresAt: new Date(Date.now() + 2 * 60 * 1000),
          },
          ...(transactionHash
            ? { $addToSet: { reputationTransactionHashes: transactionHash } }
            : {}),
        }
      );
    }

    finalization = await VotingFinalization.findByIdAndUpdate(
      finalization._id,
      {
        $set: {
          status: "COMPLETED",
          lockExpiresAt: null,
          failureReason: "",
        },
      },
      { new: true }
    );

    const reputationChanges = finalization.reputationChanges;
    voteSummary = voteSummary || {
      consensus: finalization.consensus,
      consensusCode: finalization.consensusCode,
      consensusDisplayLabel: finalization.consensus,
      consensusStrength: finalization.consensusStrength,
      weightedResults: null,
      totalVoters: finalization.totalVoters,
    };

    await logAdminAction({
      req,
      action: "FINALIZE_VOTING",
      targetType: "CLAIM",
      targetId: claimId,
      tx: {
        hash:
          finalization.reputationTransactionHashes[
            finalization.reputationTransactionHashes.length - 1
          ] || "",
      },
      receipt: reputationChanges[reputationChanges.length - 1] || null,
      metadata: {
        consensus: voteSummary.consensus,
        consensusCode: voteSummary.consensusCode,
        consensusStrength: voteSummary.consensusStrength,
        totalVoters: voteSummary.totalVoters,
        transactionHashes: finalization.reputationTransactionHashes,
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
      transactionHashes: finalization.reputationTransactionHashes,
    });
  } catch (error) {
    if (finalizationId) {
      await VotingFinalization.findByIdAndUpdate(finalizationId, {
        $set: {
          status: "FAILED",
          lockExpiresAt: null,
          failureReason: error.message,
        },
      }).catch(() => {});
    }

    next(error);
  }
};

module.exports = {
  getClaimVoteSummary,
  finalizeVoting,
};
