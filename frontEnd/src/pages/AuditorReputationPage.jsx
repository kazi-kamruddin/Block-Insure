import { useQuery } from "@tanstack/react-query";

import { getReadOnlyContract } from "../services/contractService";
import { getActiveRoleMembers } from "../utils/contractQueries";
import "../styles/pages/AuditorReputationPage.css";

function shortenAddress(address) {
  if (!address) return "-";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function toNumber(value) {
  if (value === undefined || value === null) return 0;
  if (typeof value === "bigint") return Number(value);
  return Number(value.toString ? value.toString() : value);
}

function getReliabilityLevel(score) {
  if (score >= 90) return "Expert";
  if (score >= 70) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}

async function loadAuditorReputations() {
  const contract = getReadOnlyContract();
  const auditorRole = await contract.AUDITOR_ROLE();
  const auditors = await getActiveRoleMembers(contract, auditorRole);

  return Promise.all(
    auditors.map(async (wallet) => {
      const [reputation, totalVotes] = await Promise.all([
        contract.auditorReputation(wallet),
        contract.auditorTotalVotes(wallet),
      ]);
      const reputationScore = toNumber(reputation);
      const voteCount = toNumber(totalVotes);
      const isInitialized = voteCount > 0;

      return {
        wallet,
        shortWallet: shortenAddress(wallet),
        totalVotes: voteCount,
        reputationScore,
        isInitialized,
        reliabilityLevel: isInitialized
          ? getReliabilityLevel(reputationScore)
          : "Unrated",
      };
    })
  );
}

export default function AuditorReputationPage() {
  const {
    data: auditors = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["auditorReputations"],
    queryFn: loadAuditorReputations,
  });

  return (
    <section className="page-container page-auditor-reputation">
      <h2>Auditor Reputation</h2>

      <button type="button" onClick={() => refetch()} disabled={isFetching}>
        {isFetching ? "Refreshing..." : "Refresh Reputation"}
      </button>

      {isLoading ? <p>Loading auditors...</p> : null}

      {error ? (
        <p className="error-text">
          {error.reason ||
            error.shortMessage ||
            error.message ||
            "Could not load auditor reputation"}
        </p>
      ) : null}

      {!isLoading && auditors.length === 0 ? (
        <p>No active auditor role holders found on-chain.</p>
      ) : null}

      {auditors.length > 0 ? (
        <div className="card auditor-reputation-card">
          <table>
            <thead>
              <tr>
                <th>Wallet</th>
                <th>Total Votes</th>
                <th>Reputation Score</th>
                <th>Reliability Level</th>
              </tr>
            </thead>
            <tbody>
              {auditors.map((auditor) => (
                <tr key={auditor.wallet}>
                  <td title={auditor.wallet}>{auditor.shortWallet}</td>
                  <td>{auditor.totalVotes}</td>
                  <td>
                    {auditor.isInitialized ? (
                      <>
                        <div className="reputation-meter">
                          <span style={{ width: `${auditor.reputationScore}%` }} />
                        </div>
                        <strong>{auditor.reputationScore}/100</strong>
                      </>
                    ) : (
                      <strong>Not initialized</strong>
                    )}
                  </td>
                  <td>
                    <span
                      className={`reliability-pill reliability-${auditor.reliabilityLevel.toLowerCase()}`}
                    >
                      {auditor.reliabilityLevel}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
