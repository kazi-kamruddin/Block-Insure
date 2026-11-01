export default function PaymentScheduleNotice({ schedule }) {
  if (!schedule) return null;
  return <aside className="my-3 rounded-lg border border-current/20 p-3 text-sm leading-relaxed" aria-label="Payment calendar">
    <strong>{schedule.label}</strong>
    <p>Every {schedule.intervalLabel}; payment opens {schedule.advanceWindowLabel} before due.</p>
    <p>{schedule.notice}</p>
  </aside>;
}
