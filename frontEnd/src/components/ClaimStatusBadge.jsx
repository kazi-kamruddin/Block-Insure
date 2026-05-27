import { getStatusLabel } from "../services/contractService";

export default function ClaimStatusBadge({ status }) {
  const label =
    typeof status === "string" && Number.isNaN(Number(status))
      ? status
      : getStatusLabel(status);

  return <span className={`status-badge status-${label}`}>{label}</span>;
}