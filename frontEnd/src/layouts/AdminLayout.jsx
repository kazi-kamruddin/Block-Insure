import RoleWorkspaceLayout from "./RoleWorkspaceLayout";

const ADMIN_LINKS = [
  { to: "/admin/dashboard", label: "Overview", end: true },
  { to: "/admin/policy-packages", label: "Packages", end: true },
  { to: "/admin/policy-packages/new", label: "Create Package" },
  { to: "/admin/benefits", label: "Benefits" },
  { to: "/admin/healthcare-registry", label: "Registry" },
  { to: "/admin/thesis-dashboard", label: "Thesis Results" },
  { to: "/admin/audit-actions", label: "Action Audit" },
  { to: "/admin/role-health", label: "Role Health" },
  { to: "/admin/claims", label: "Claims" },
  { to: "/admin/notifications", label: "Notifications" },
];

export default function AdminLayout() {
  return (
    <RoleWorkspaceLayout
      expectedRole="ADMIN"
      navigationLabel="Administration navigation"
      links={ADMIN_LINKS}
    />
  );
}
