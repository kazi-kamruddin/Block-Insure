// Fulfillment includes timeout and disagreement, not only matching reveals.
export function describeOracleFinalization(request) {
  if (!request.isFulfilled) return { quorumReached: false, message: "Awaiting additional oracle confirmation." };
  switch (Number(request.finalizationCode)) {
    case 1:
      return { quorumReached: true, message: "Oracle quorum reached." };
    case 2:
      return { quorumReached: false, message: "Oracle results disagreed; request finalized without a quorum." };
    case 3:
      return { quorumReached: false, message: "Oracle request timed out without a quorum." };
    default:
      return { quorumReached: false, message: "Oracle request finalized; inspect its recorded outcome." };
  }
}
