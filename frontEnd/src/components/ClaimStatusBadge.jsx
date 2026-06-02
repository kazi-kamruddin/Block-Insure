import { getStatusExplanation, normalizeStatus } from "../utils/claimStatus";

export default function ClaimStatusBadge({ status, showHelp = false }) {
  const label = normalizeStatus(status);
  const explanation = getStatusExplanation(label);

  return (
    <span className="status-wrapper">
      <span
        className={`status-badge status-${label.toLowerCase()}`}
        title={explanation}
      >
        {label}
      </span>

      {showHelp ? <span className="status-help-text"> {explanation}</span> : null}
    </span>
  );
}