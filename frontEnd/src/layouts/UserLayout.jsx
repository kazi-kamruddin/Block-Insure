import RoleWorkspaceLayout from "./RoleWorkspaceLayout";

const POLICYHOLDER_LINKS = [
  { to: "/user/dashboard", label: "Overview", end: true },
  { to: "/user/policies/buy", label: "Buy Policy" },
  { to: "/user/policies", label: "My Policies", end: true },
  { to: "/user/payments", label: "Payments & Statements" },
  { to: "/user/banking", label: "Banking & EFT" },
  { to: "/user/claims", label: "My Claims", end: true },
  { to: "/user/claims/new", label: "Submit Claim" },
  { to: "/user/benefits", label: "Beneficiary Benefits" },
  { to: "/user/notifications", label: "Notifications" },
];

export default function UserLayout() {
  return (
    <RoleWorkspaceLayout
      expectedRole="USER"
      navigationLabel="Policyholder navigation"
      links={POLICYHOLDER_LINKS}
    />
  );
}
