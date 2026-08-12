import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { WalletProvider } from "./context/WalletContext";
import ToastViewport from "./components/ToastViewport";

import PublicLayout from "./layouts/PublicLayout";
import UserLayout from "./layouts/UserLayout";
import AdminLayout from "./layouts/AdminLayout";
import AuditorLayout from "./layouts/AuditorLayout";

const HomePage = lazy(() => import("./pages/HomePage"));
const UserDashboardPage = lazy(() => import("./pages/UserDashboardPage"));
const AdminDashboardPage = lazy(() => import("./pages/AdminDashboardPage"));
const AuditorDashboardPage = lazy(() => import("./pages/AuditorDashboardPage"));
const AuditorClaimLookupPage = lazy(
  () => import("./pages/AuditorClaimLookupPage")
);
const AuditorClaimHistoryPage = lazy(
  () => import("./pages/AuditorClaimHistoryPage")
);
const AuditorVoteQueuePage = lazy(
  () => import("./pages/AuditorVoteQueuePage")
);
const AuditorVotingPage = lazy(() => import("./pages/AuditorVotingPage"));
const AuditorReputationPage = lazy(
  () => import("./pages/AuditorReputationPage")
);
const AuditorDocumentVerificationPage = lazy(
  () => import("./pages/AuditorDocumentVerificationPage")
);
const AdminPolicyPackagesPage = lazy(
  () => import("./pages/AdminPolicyPackagesPage")
);
const AdminCreatePolicyPackagePage = lazy(
  () => import("./pages/AdminCreatePolicyPackagePage")
);
const PolicyListPage = lazy(() => import("./pages/PolicyListPage"));
const MyPoliciesPage = lazy(() => import("./pages/MyPoliciesPage"));
const SubmitClaimPage = lazy(() => import("./pages/SubmitClaimPage"));
const MyClaimsPage = lazy(() => import("./pages/MyClaimsPage"));
const ClaimDetailPage = lazy(() => import("./pages/ClaimDetailPage"));
const AdminClaimListPage = lazy(() => import("./pages/AdminClaimListPage"));
const AdminClaimDetailPage = lazy(() => import("./pages/AdminClaimDetailPage"));
const AdminActionAuditPage = lazy(() => import("./pages/AdminActionAuditPage"));
const AdminRoleHealthPage = lazy(() => import("./pages/AdminRoleHealthPage"));
const HealthcareRegistryPage = lazy(
  () => import("./pages/HealthcareRegistryPage")
);
const ThesisResultsDashboardPage = lazy(
  () => import("./pages/ThesisResultsDashboardPage")
);
const NotificationsPage = lazy(() => import("./pages/NotificationsPage"));
const BenefitClaimPage = lazy(() => import("./pages/BenefitClaimPage"));
const AdminBenefitsPage = lazy(() => import("./pages/AdminBenefitsPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));

import "./App.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <ToastViewport />
        <BrowserRouter>
          <Suspense
            fallback={
              <div className="route-loading" role="status" aria-live="polite">
                Loading workspace...
              </div>
            }
          >
            <Routes>
              <Route element={<PublicLayout />}>
              <Route index element={<HomePage />} />
              <Route path="login" element={<HomePage />} />

              <Route path="user" element={<UserLayout />}>
                <Route index element={<Navigate to="/user/dashboard" replace />} />
                <Route path="dashboard" element={<UserDashboardPage />} />
                <Route path="policies" element={<MyPoliciesPage />} />
                <Route path="policies/buy" element={<PolicyListPage />} />
                <Route path="claims" element={<MyClaimsPage />} />
                <Route path="claims/new" element={<SubmitClaimPage />} />
                <Route path="benefits" element={<BenefitClaimPage />} />
                <Route path="claims/:id" element={<ClaimDetailPage />} />
                <Route path="notifications" element={<NotificationsPage />} />
              </Route>

              <Route path="admin" element={<AdminLayout />}>
                <Route index element={<Navigate to="/admin/dashboard" replace />} />
                <Route path="dashboard" element={<AdminDashboardPage />} />
                <Route path="policy-packages" element={<AdminPolicyPackagesPage />} />
                <Route path="benefits" element={<AdminBenefitsPage />} />
                <Route
                  path="policy-packages/new"
                  element={<AdminCreatePolicyPackagePage />}
                />
                <Route path="healthcare-registry" element={<HealthcareRegistryPage />} />
                <Route path="thesis-dashboard" element={<ThesisResultsDashboardPage />} />
                <Route path="audit-actions" element={<AdminActionAuditPage />} />
                <Route path="role-health" element={<AdminRoleHealthPage />} />
                <Route path="claims" element={<AdminClaimListPage />} />
                <Route path="claims/:id" element={<AdminClaimDetailPage />} />
                <Route path="notifications" element={<NotificationsPage />} />
              </Route>

              <Route path="auditor" element={<AuditorLayout />}>
                <Route index element={<Navigate to="/auditor/dashboard" replace />} />
                <Route path="dashboard" element={<AuditorDashboardPage />} />
                <Route path="healthcare-registry" element={<HealthcareRegistryPage />} />
                <Route path="claims" element={<AuditorClaimLookupPage />} />
                <Route path="claims/:id/history" element={<AuditorClaimHistoryPage />} />
                <Route path="votes" element={<AuditorVoteQueuePage />} />
                <Route path="vote/:claimId" element={<AuditorVotingPage />} />
                <Route path="reputation" element={<AuditorReputationPage />} />
                <Route path="verify-document" element={<AuditorDocumentVerificationPage />} />
              </Route>

                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </WalletProvider>
    </QueryClientProvider>
  );
}
