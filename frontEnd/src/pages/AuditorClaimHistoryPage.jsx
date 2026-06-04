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

      <div className="timeline">
        {events.map((event, index) => (
          <div
            className="timeline-item"
            key={`${event.eventName || event.name || "event"}-${index}`}
          >
            <h3>{getEventLabel(event)}</h3>

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

      {oracleLogs.map((log) => (
        <div className="card" key={log._id || log.requestId || log.resultHash}>
          <p>Request ID: {formatValue(log.requestId)}</p>
          <p>Verified: {formatValue(log.verified)}</p>
          <p>Risk level: {formatValue(log.riskLevel)}</p>
          <p>
            Transaction:{" "}
            <TransactionLink txHash={log.submittedTxHash || log.txHash} />
          </p>
          <OracleComparisonPanel log={log} />
        </div>
      ))}
    </section>
  );
}
