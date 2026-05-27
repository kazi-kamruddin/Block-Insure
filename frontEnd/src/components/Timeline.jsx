import TransactionLink from "./TransactionLink";

export default function Timeline({ events = [] }) {
  if (!events.length) {
    return <p>No timeline events found.</p>;
  }

  return (
    <div className="timeline">
      {events.map((event, index) => (
        <div
          className="timeline-item"
          key={`${event.txHash || event.eventName || "event"}-${index}`}
        >
          <strong>{event.label || event.eventName || "Event"}</strong>
          <div>Actor: {event.actor || event.wallet || event.address || "-"}</div>
          <div>Time: {event.timestamp || event.time || "-"}</div>
          <div>
            Tx: <TransactionLink txHash={event.txHash} />
          </div>
        </div>
      ))}
    </div>
  );
}