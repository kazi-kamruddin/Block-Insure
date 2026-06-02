import CopyableText from "./CopyableText";

export default function EvidenceField({ label, value, short = true }) {
  return (
    <p className="evidence-field">
      <strong>{label}:</strong>{" "}
      <CopyableText value={value} label="Copy" short={short} />
    </p>
  );
}