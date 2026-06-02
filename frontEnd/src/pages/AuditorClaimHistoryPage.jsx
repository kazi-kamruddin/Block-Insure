import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import TransactionLink from "../components/TransactionLink";
import CopyableText from "../components/CopyableText";
import { getClaimAuditTimeline } from "../services/api";

function extractEvents(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.timeline)) return data.timeline;
  if (Array.isArray(data?.events)) return data.events;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.data?.timeline)) return data.data.timeline;
  return [];
}

function formatValue(value) {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "bigint") return value.toString();

  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }

  return String(value);
}

function formatTimestamp(value) {
  if (!value) return "-";

  if (typeof value === "object") {
    if (value.iso) return new Date(value.iso).toLocaleString();
    if (value.unix) return new Date(Number(value.unix) * 1000).toLocaleString();
  }

  const numericValue = Number(value);

  if (Number.isNaN(numericValue)) return String(value);

  return new Date(numericValue * 1000).toLocaleString();
}

export default function AuditorClaimHistoryPage() {
  const { id } = useParams();

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["claimAuditTimeline", id],
    queryFn: () => getClaimAuditTimeline(id),
    enabled: Boolean(id),
  });

  const events = extractEvents(data);

  return (
    <section className="page-container">
      <h2>Auditor Claim History</h2>

      <p>
        <Link to="/auditor/claims">Back to claim lookup</Link>
      </p>

      <button type="button" onClick={() => refetch()} disabled={isFetching}>
        {isFetching ? "Refreshing..." : "Refresh Timeline"}
      </button>

      {isLoading ? <p>Loading audit timeline...</p> : null}

      {error ? (
        <p className="error-text">
          {error.response?.data?.message ||
            error.response?.data?.error ||
            error.message ||
            "Could not load audit timeline"}
        </p>
      ) : null}

      {!isLoading && events.length === 0 ? (
        <p>No audit events found for claim #{id}.</p>
      ) : null}

      <div className="timeline">
        {events.map((event, index) => (
          <div
            className="timeline-item"
            key={`${event.eventName || event.name || "event"}-${index}`}
          >
            <h3>{event.eventName || event.name || event.label || "Event"}</h3>

            <p>Block: {formatValue(event.blockNumber)}</p>
            <p>Log index: {formatValue(event.logIndex)}</p>
            <p>Time: {formatTimestamp(event.timestamp)}</p>
            <p>
              Transaction:{" "}
              <TransactionLink txHash={event.txHash || event.transactionHash} />
            </p>

            {event.args || event.details ? (
              <>
                <p>
                  Raw details:{" "}
                  <CopyableText
                    value={formatValue(event.args || event.details)}
                    label="Copy details"
                    short
                  />
                </p>

                <pre className="pre-box">
                  {formatValue(event.args || event.details)}
                </pre>
              </>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
