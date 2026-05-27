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
import PolicyListPage from "./pages/PolicyListPage";
import MyPoliciesPage from "./pages/MyPoliciesPage";
import SubmitClaimPage from "./pages/SubmitClaimPage";
import MyClaimsPage from "./pages/MyClaimsPage";
import ClaimDetailPage from "./pages/ClaimDetailPage";
import AdminClaimListPage from "./pages/AdminClaimListPage";
import AdminClaimDetailPage from "./pages/AdminClaimDetailPage";
import PlaceholderPage from "./pages/PlaceholderPage";
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
              </Route>

              <Route path="admin" element={<AdminLayout />}>
                <Route index element={<Navigate to="/admin/dashboard" replace />} />
                <Route path="dashboard" element={<AdminDashboardPage />} />
                <Route
                  path="policy-packages/new"
                  element={<PlaceholderPage title="Create Policy Package" />}
                />
                <Route path="claims" element={<AdminClaimListPage />} />
                <Route path="claims/:id" element={<AdminClaimDetailPage />} />
              </Route>

              <Route path="auditor" element={<AuditorLayout />}>
                <Route
                  index
                  element={<Navigate to="/auditor/dashboard" replace />}
                />
                <Route path="dashboard" element={<AuditorDashboardPage />} />
                <Route
                  path="claims"
                  element={<PlaceholderPage title="Auditor Claims" />}
                />
                <Route
                  path="claims/:id/history"
                  element={<PlaceholderPage title="Auditor Claim History" />}
                />
              </Route>

              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </WalletProvider>
    </QueryClientProvider>
  );
}