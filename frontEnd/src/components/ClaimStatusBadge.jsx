import { getStatusLabel } from "../services/contractService";

function normalizeStatusValue(status) {
  if (status === undefined || status === null) {
    return "UNKNOWN";
  }

  if (typeof status === "object") {
    if (status.label) return status.label;
    if (status.name) return status.name;
    if (status.statusLabel) return status.statusLabel;
    if (status.statusName) return status.statusName;
    if (status.code !== undefined) return status.code;
    if (status.value !== undefined) return status.value;
    if (status._hex) return Number(status._hex);
    return "UNKNOWN";
  }

  return status;
}

export default function ClaimStatusBadge({ status }) {
  const normalizedStatus = normalizeStatusValue(status);

  const label =
    typeof normalizedStatus === "string" &&
    Number.isNaN(Number(normalizedStatus))
      ? normalizedStatus
      : getStatusLabel(normalizedStatus);

  return <span className={`status-badge status-${label}`}>{label}</span>;
}