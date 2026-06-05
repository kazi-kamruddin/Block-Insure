import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import TransactionLink from "../components/TransactionLink";
import CopyableText from "../components/CopyableText";
import EvidenceChainPanel from "../components/EvidenceChainPanel";
import OracleComparisonPanel from "../components/OracleComparisonPanel";
import {
  getClaimAuditTimeline,
  getClaimById,
  getOracleResults,
} from "../services/api";
import "../styles/pages/AuditorClaimHistoryPage.css";

const EVENT_META = {
  ClaimSubmitted: {
    actor: "User",
    tone: "user",
    summary: "Claim opened with the initial evidence commitment.",
  },
  DocumentAdded: {
    actor: "User",
    tone: "user",
    summary: "A document hash and CID were linked to this claim.",
  },
  ClaimFlagged: {
    actor: "Contract",
    tone: "warning",
    summary: "Automatic duplicate or fraud checks flagged the claim.",
  },
  OracleRequested: {
    actor: "Admin",
    tone: "admin",
    summary: "Verification was requested from the oracle network.",
  },
  OracleConfirmationReceived: {
    actor: "Oracle",
    tone: "oracle",
    summary: "One oracle submitted an individual confirmation.",
  },
  OracleResultSubmitted: {
    actor: "Oracle",
    tone: "oracle",
    summary: "Oracle quorum finished and the claim status was updated.",
  },
  OracleTimedOut: {
    actor: "Admin",
    tone: "warning",
    summary: "The oracle request was marked failed after timeout.",
  },
  ClaimApproved: {
    actor: "Admin",
    tone: "admin",
    summary: "The claim was approved for settlement.",
  },
  ClaimRejected: {
    actor: "Admin",
    tone: "danger",
    summary: "The claim was rejected with a reason hash.",
  },
  ClaimAppealed: {
    actor: "User",
    tone: "user",
    summary: "The claimant appealed the rejection.",
  },
  ClaimReopenedAfterAppeal: {
    actor: "Admin",
    tone: "admin",
    summary: "The appeal reopened the claim for another review path.",
  },
  ClaimAppealFinalized: {
    actor: "Admin",
    tone: "admin",
    summary: "The appeal review was finalized.",
  },
  ClaimSentToManualReview: {
    actor: "Admin",
    tone: "admin",
    summary: "The claim was routed to human review.",
  },
  AuditorVoteCast: {
    actor: "Auditor",
    tone: "auditor",
    summary: "An auditor submitted a weighted vote.",
  },
  SettlementCalculated: {
    actor: "Admin",
    tone: "settlement",
    summary: "The deductible and payout amounts were calculated.",
  },
  ClaimSettled: {
    actor: "Admin",
    tone: "settlement",
    summary: "The approved payout was transferred from the reserve.",
  },
  ClaimClosed: {
    actor: "Admin",
    tone: "settlement",
    summary: "The claim lifecycle was closed.",
  },
};

function extractEvents(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.timeline)) return data.timeline;
  if (Array.isArray(data?.events)) return data.events;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.data?.timeline)) return data.data.timeline;
  return [];
}

function extractOracleLogs(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.logs)) return data.logs;
  if (Array.isArray(data?.oracleLogs)) return data.oracleLogs;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function extractEvidenceChain(data) {
  return data?.evidenceChain || data?.data?.evidenceChain || null;
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

const EVENT_LABELS = {
  ClaimSubmitted: "Claim Submitted",
  DocumentAdded: "Document Added",
  ClaimFlagged: "Claim Flagged",
  OracleRequested: "Oracle Requested",
  OracleConfirmationReceived: "Oracle Confirmation Received",
  OracleResultSubmitted: "Oracle Result Submitted",
  OracleTimedOut: "Oracle Timed Out",
  ClaimApproved: "Claim Approved",
  ClaimRejected: "Claim Rejected",
  ClaimAppealed: "Claim Appealed",
  ClaimReopenedAfterAppeal: "Claim Reopened After Appeal",
  ClaimAppealFinalized: "Claim Appeal Finalized",
  ClaimSentToManualReview: "Claim Sent To Manual Review",
  AuditorVoteCast: "Auditor Vote Cast",
  SettlementCalculated: "Settlement Calculated",
  ClaimSettled: "Claim Settled",
  ClaimClosed: "Claim Closed",
};

function getEventArgs(event) {
  return event.args || event.details || {};
}

function shortenAddress(value) {
  if (!value || typeof value !== "string") return "-";
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function getEventLabel(event) {
  const eventName = event.eventName || event.name || event.label || "Event";

  if (eventName === "OracleConfirmationReceived") {
    const args = getEventArgs(event);
    const confirmationCount = args.confirmationCount ?? "?";
    const oracleLabel = args.oracle ? ` from ${shortenAddress(args.oracle)}` : "";

    return `Oracle Confirmation #${confirmationCount} received${oracleLabel}`;
  }

  return EVENT_LABELS[eventName] || eventName;
}

function getEventName(event) {
  return event.eventName || event.name || event.label || "Event";
}

function getEventMeta(event) {
  return (
    EVENT_META[getEventName(event)] || {
      actor: "System",
      tone: "system",
      summary: "Recorded blockchain lifecycle event.",
    }
  );
}

function getEventSummary(event) {
  const args = getEventArgs(event);
  const eventName = getEventName(event);

  if (eventName === "ClaimSubmitted") {
    return `Amount ${formatValue(args.claimAmount)} wei from ${shortenAddress(args.claimant)}`;
  }

  if (eventName === "DocumentAdded") {
    return `Document ${shortenAddress(args.documentHash)} stored with CID ${formatValue(args.documentCID)}`;
  }

  if (eventName === "ClaimFlagged") {
    return formatValue(args.reason || args[1] || getEventMeta(event).summary);
  }

  if (eventName === "OracleRequested") {
    return `Request #${formatValue(args.requestId)} for ${formatValue(args.oracleType)}`;
  }

  if (eventName === "OracleResultSubmitted") {
    return `Request #${formatValue(args.requestId)} final result: ${
      args.verified ? "verified" : "failed"
    }`;
  }

  if (eventName === "AuditorVoteCast") {
    return `Vote ${formatValue(args.vote)} by ${shortenAddress(args.auditor)}`;
  }

  if (eventName === "ClaimSettled") {
    return `Paid ${formatValue(args.amount)} wei to ${shortenAddress(args.recipient)}`;
  }

  return getEventMeta(event).summary;
}

function getOracleLogKey(log) {
  return [
    log.requestId,
    log.submittedTxHash || log.txHash,
    log.resultHash,
    log.responseData?.oracleInstanceId,
    log.responseData?.oracleWallet,
    log.responseData?.registrySnapshot,
  ]
    .filter(Boolean)
    .join("|");
}

function uniqueOracleLogs(logs) {
  const seen = new Set();

  return logs.filter((log) => {
    const key = getOracleLogKey(log) || log._id;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function groupOracleLogs(logs) {
  return uniqueOracleLogs(logs).reduce((groups, log) => {
    const requestId = formatValue(log.requestId);
    const existing = groups.get(requestId) || [];
    existing.push(log);
    groups.set(requestId, existing);
    return groups;
  }, new Map());
}

function getOracleLabel(log) {
  const instanceId = log.responseData?.oracleInstanceId;
  const wallet = log.responseData?.oracleWallet;
  const snapshot = log.responseData?.registrySnapshot;

  return [
    instanceId ? `Oracle ${instanceId}` : "Oracle log",
    wallet ? shortenAddress(wallet) : null,
    snapshot ? `snapshot: ${snapshot}` : null,
  ]
    .filter(Boolean)
    .join(" / ");
}

function OracleLogSummary({ log }) {
  return (
    <details className="oracle-log-entry" open>
      <summary>
        <span>{getOracleLabel(log)}</span>
        <strong>{log.verified ? "Verified" : "Failed"}</strong>
        <em>{formatValue(log.riskLevel)}</em>
      </summary>

      <div className="oracle-log-meta">
        <p>Transaction: <TransactionLink txHash={log.submittedTxHash || log.txHash} /></p>
        <p>Result hash: {shortenAddress(log.resultHash)}</p>
        <p>Created: {formatTimestamp(log.createdAt)}</p>
      </div>

      <OracleComparisonPanel log={log} />

      {!(
        log?.responseData?.hospitalVerification?.comparison ||
        log?.hospitalVerification?.comparison ||
        log?.responseData?.comparison ||
        log?.comparison
      ) ? (
        <p className="muted-text">
          This oracle log has no detailed registry comparison payload.
        </p>
      ) : null}
    </details>
  );
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

  const {
    data: oracleData,
    isLoading: oracleLoading,
    isFetching: oracleFetching,
    refetch: refetchOracle,
  } = useQuery({
    queryKey: ["auditorOracleResults", id],
    queryFn: () => getOracleResults(id),
    enabled: Boolean(id),
  });

  const {
    data: claimData,
    isLoading: claimLoading,
    isFetching: claimFetching,
    refetch: refetchClaim,
  } = useQuery({
    queryKey: ["auditorClaimEvidence", id],
    queryFn: () => getClaimById(id),
    enabled: Boolean(id),
  });

  const events = extractEvents(data);
  const oracleLogs = extractOracleLogs(oracleData);
  const evidenceChain = extractEvidenceChain(claimData);
  const eventStats = useMemo(() => {
    const actors = new Set(events.map((event) => getEventMeta(event).actor));
    const lastEvent = events[events.length - 1] || null;

    return {
      actors: actors.size,
      firstBlock: events[0]?.blockNumber,
      lastBlock: lastEvent?.blockNumber,
      lastEventLabel: lastEvent ? getEventLabel(lastEvent) : "-",
    };
  }, [events]);
  const oracleGroups = useMemo(() => groupOracleLogs(oracleLogs), [oracleLogs]);

  return (
    <section className="page-container page-auditor-claim-history">
      <h2>Auditor Claim History</h2>

      <p>
        <Link to="/auditor/claims">Back to claim lookup</Link>
      </p>

      <button
        type="button"
        onClick={() => {
          refetch();
          refetchOracle();
          refetchClaim();
        }}
        disabled={isFetching || oracleFetching || claimFetching}
      >
        {isFetching || oracleFetching || claimFetching
          ? "Refreshing..."
          : "Refresh Timeline"}
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

      {events.length > 0 ? (
        <div className="history-summary-grid">
          <div>
            <span>Events</span>
            <strong>{events.length}</strong>
          </div>
          <div>
            <span>Roles Involved</span>
            <strong>{eventStats.actors}</strong>
          </div>
          <div>
            <span>Block Range</span>
            <strong>
              {formatValue(eventStats.firstBlock)}-{formatValue(eventStats.lastBlock)}
            </strong>
          </div>
          <div>
            <span>Latest Step</span>
            <strong>{eventStats.lastEventLabel}</strong>
          </div>
        </div>
      ) : null}

      <div className="timeline compact-timeline">
        {events.map((event, index) => (
          <div
            className={`timeline-item compact-timeline-item tone-${getEventMeta(event).tone}`}
            key={`${event.eventName || event.name || "event"}-${index}`}
          >
            <div className="compact-event-marker">{index + 1}</div>
            <div className="compact-event-body">
              <div className="compact-event-head">
                <div>
                  <span className="event-role">{getEventMeta(event).actor}</span>
                  <h3>{getEventLabel(event)}</h3>
                </div>
                <span className="event-block">Block {formatValue(event.blockNumber)}</span>
              </div>

              <p>{getEventSummary(event)}</p>

              <div className="event-meta-row">
                <span>{formatTimestamp(event.timestamp)}</span>
                <span>Log {formatValue(event.logIndex)}</span>
                <TransactionLink txHash={event.txHash || event.transactionHash} />
              </div>

              {event.args || event.details ? (
                <details className="raw-details">
                  <summary>
                    Raw event details{" "}
                    <CopyableText
                      value={formatValue(event.args || event.details)}
                      label="Copy details"
                      short
                    />
                  </summary>
                  <pre className="pre-box">
                    {formatValue(event.args || event.details)}
                  </pre>
                </details>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <h3>Evidence Hash Chain</h3>

      {claimLoading ? <p>Loading evidence chain...</p> : null}

      {!claimLoading ? (
        <EvidenceChainPanel evidenceChain={evidenceChain} />
      ) : null}

      <h3>Oracle Registry Comparison</h3>

      {oracleLoading ? <p>Loading oracle comparison...</p> : null}

      {!oracleLoading && oracleLogs.length === 0 ? (
        <p>No oracle registry comparison found for claim #{id}.</p>
      ) : null}

      {Array.from(oracleGroups.entries()).map(([requestId, logs]) => (
        <div className="card oracle-request-group" key={requestId}>
          <div className="oracle-request-head">
            <div>
              <span className="event-role">Oracle Request</span>
              <h4>Request #{requestId}</h4>
            </div>
            <strong>{logs.length} log{logs.length === 1 ? "" : "s"}</strong>
          </div>

          <div className="oracle-log-list">
            {logs.map((log) => (
              <OracleLogSummary
                log={log}
                key={log._id || getOracleLogKey(log) || `${requestId}-${log.resultHash}`}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
