import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';

// Pages
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';
import StudioPage from './pages/StudioPage';
import ProjectsPage from './pages/ProjectsPage';
import LibraryPage from './pages/LibraryPage';
import { BrandAssetLibraryPage } from './pages/BrandAssetLibraryPage';
import AnalyticsPage from './pages/AnalyticsPage';
import PricingPage from './pages/PricingPage';
import ProvidersPage from './pages/ProvidersPage';
import SettingsPage from './pages/SettingsPage';
import AppLayout from './components/layout/AppLayout';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-ink-900 flex items-center justify-center">
        <div className="relative">
          <div className="w-12 h-12 rounded-full border-2 border-gold-400/20 border-t-gold-400 animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center text-gold-400 text-sm font-bold">A</div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/auth" state={{ from: location }} replace />;
  return <>{children}</>;
}

export default function App() {
  const { loadMe } = useAuthStore();

  useEffect(() => { loadMe(); }, []);

  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/auth/reset-password" element={<AuthPage mode="reset" />} />

      <Route path="/" element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="studio" element={<StudioPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="brand-assets" element={<BrandAssetLibraryPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="pricing" element={<PricingPage />} />
        <Route path="providers" element={<ProvidersPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
