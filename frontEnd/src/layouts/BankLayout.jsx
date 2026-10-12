import RoleWorkspaceLayout from "./RoleWorkspaceLayout";

const BANK_LINKS = [
  { to: "/bank/dashboard", label: "Bank Overview", end: true },
];

export default function BankLayout() {
  return (
    <RoleWorkspaceLayout
      expectedRole="BANK"
      navigationLabel="Bank navigation"
      links={BANK_LINKS}
    />
  );
}
