import RoleWorkspaceLayout from "./RoleWorkspaceLayout";

const AUDITOR_LINKS = [
  { to: "/auditor/dashboard", label: "Overview", end: true },
  { to: "/auditor/healthcare-registry", label: "Registry" },
  { to: "/auditor/claims", label: "Audit Timelines" },
  { to: "/auditor/votes", label: "Voting Queue" },
  { to: "/auditor/verify-document", label: "Verify Document" },
  { to: "/auditor/reputation", label: "Reputation" },
];

export default function AuditorLayout() {
  return (
    <RoleWorkspaceLayout
      expectedRole="AUDITOR"
      navigationLabel="Auditor navigation"
      links={AUDITOR_LINKS}
    />
  );
}
