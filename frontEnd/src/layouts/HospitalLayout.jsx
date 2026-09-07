import RoleWorkspaceLayout from "./RoleWorkspaceLayout";

const HOSPITAL_LINKS = [
  { to: "/hospital/dashboard", label: "Overview", end: true },
  { to: "/hospital/records", label: "Patient & Invoices" },
  { to: "/hospital/claims", label: "Claim Requests" },
];

export default function HospitalLayout() {
  return (
    <RoleWorkspaceLayout
      expectedRole="HOSPITAL"
      navigationLabel="Hospital navigation"
      links={HOSPITAL_LINKS}
    />
  );
}
