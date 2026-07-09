import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { WalletProvider } from "./context/WalletContext";

import PublicLayout from "./layouts/PublicLayout";
import UserLayout from "./layouts/UserLayout";
import AdminLayout from "./layouts/AdminLayout";
import AuditorLayout from "./layouts/AuditorLayout";

import HomePage from "./pages/HomePage";
import UserDashboardPage from "./pages/UserDashboardPage";
import AdminDashboardPage from "./pages/AdminDashboardPage";
import AuditorDashboardPage from "./pages/AuditorDashboardPage";
import AuditorClaimLookupPage from "./pages/AuditorClaimLookupPage";
import AuditorClaimHistoryPage from "./pages/AuditorClaimHistoryPage";
import AuditorVoteQueuePage from "./pages/AuditorVoteQueuePage";
import AuditorVotingPage from "./pages/AuditorVotingPage";
import AuditorReputationPage from "./pages/AuditorReputationPage";
import AuditorDocumentVerificationPage from "./pages/AuditorDocumentVerificationPage";
import AdminPolicyPackagesPage from "./pages/AdminPolicyPackagesPage";
import AdminCreatePolicyPackagePage from "./pages/AdminCreatePolicyPackagePage";
import PolicyListPage from "./pages/PolicyListPage";
import MyPoliciesPage from "./pages/MyPoliciesPage";
import SubmitClaimPage from "./pages/SubmitClaimPage";
import MyClaimsPage from "./pages/MyClaimsPage";
import ClaimDetailPage from "./pages/ClaimDetailPage";
import AdminClaimListPage from "./pages/AdminClaimListPage";
import AdminClaimDetailPage from "./pages/AdminClaimDetailPage";
import AdminActionAuditPage from "./pages/AdminActionAuditPage";
import AdminRoleHealthPage from "./pages/AdminRoleHealthPage";
import HealthcareRegistryPage from "./pages/HealthcareRegistryPage";
import ThesisResultsDashboardPage from "./pages/ThesisResultsDashboardPage";
import NotificationsPage from "./pages/NotificationsPage";
import NotFoundPage from "./pages/NotFoundPage";

import "./App.css";

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <BrowserRouter>
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
                <Route path="claims/:id" element={<ClaimDetailPage />} />
                <Route path="notifications" element={<NotificationsPage />} />
              </Route>

              <Route path="admin" element={<AdminLayout />}>
                <Route index element={<Navigate to="/admin/dashboard" replace />} />
                <Route path="dashboard" element={<AdminDashboardPage />} />
                <Route path="policy-packages" element={<AdminPolicyPackagesPage />} />
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
        </BrowserRouter>
      </WalletProvider>
    </QueryClientProvider>
  );
}
