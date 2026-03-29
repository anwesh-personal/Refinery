import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './Layout';
import { ProtectedRoute } from './auth/ProtectedRoute';
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import IngestionPage from './pages/Ingestion';
import DatabasePage from './pages/Database';
import SegmentsPage from './pages/Segments';
import VerificationPage from './pages/Verification';
import TargetsPage from './pages/Targets';
import QueuePage from './pages/Queue';
import ConfigPage from './pages/Config';
import LogsPage from './pages/Logs';
import TeamPage from './pages/Team';
import SettingsPage from './pages/Settings';
import NotFoundPage from './pages/NotFound';
import EmailVerifierPage from './pages/EmailVerifier';
import TutorialPage from './pages/Tutorial';
import JanitorPage from './pages/Janitor';
import MTAConfigPage from './pages/MTAConfig';
import AINexusPage from './pages/AINexus';
import SEOIntelligencePage from './pages/SEOIntelligence';
import BoardroomPage from './pages/Boardroom';
import ImpersonationBanner from './components/ImpersonationBanner';
import { CommandPalette } from './components/CommandPalette';
import { ServerProvider } from './components/ServerSelector';

export default function App() {
  return (
    <BrowserRouter>
      <CommandPalette />
      <ImpersonationBanner />
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />

        {/* Protected — wrapped in Layout shell */}
        <Route
          path="*"
          element={
            <ProtectedRoute>
              <ServerProvider>
                <Layout>
                  <Routes>
                    <Route path="/" element={<DashboardPage />} />
                    <Route path="/ingestion" element={<ProtectedRoute requires="canViewIngestion"><IngestionPage /></ProtectedRoute>} />
                    <Route path="/database" element={<ProtectedRoute requires="canViewDatabase"><DatabasePage /></ProtectedRoute>} />
                    <Route path="/segments" element={<ProtectedRoute requires="canViewSegments"><SegmentsPage /></ProtectedRoute>} />
                    <Route path="/verification" element={<ProtectedRoute requires="canViewVerification"><VerificationPage /></ProtectedRoute>} />
                    <Route path="/email-verifier" element={<ProtectedRoute requires="canViewVerification"><EmailVerifierPage /></ProtectedRoute>} />
                    <Route path="/targets" element={<ProtectedRoute requires="canViewTargets"><TargetsPage /></ProtectedRoute>} />
                    <Route path="/queue" element={<ProtectedRoute requires="canViewQueue"><QueuePage /></ProtectedRoute>} />
                    <Route path="/config" element={<ProtectedRoute requires="canViewConfig"><ConfigPage /></ProtectedRoute>} />
                    <Route path="/team" element={<ProtectedRoute requires="canManageUsers"><TeamPage /></ProtectedRoute>} />
                    <Route path="/logs" element={<ProtectedRoute requires="canViewLogs"><LogsPage /></ProtectedRoute>} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/tutorial" element={<TutorialPage />} />
                    <Route path="/janitor" element={<JanitorPage />} />
                    <Route path="/mta-config" element={<ProtectedRoute requires="canViewConfig"><MTAConfigPage /></ProtectedRoute>} />
                    <Route path="/ai-nexus" element={<ProtectedRoute requires="canViewConfig"><AINexusPage /></ProtectedRoute>} />
                    <Route path="/seo-intelligence" element={<ProtectedRoute requires="canViewConfig"><SEOIntelligencePage /></ProtectedRoute>} />
                    <Route path="/boardroom" element={<ProtectedRoute requires="canViewConfig"><BoardroomPage /></ProtectedRoute>} />
                    {/* Catch-all 404 for protected routes */}
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </Layout>
              </ServerProvider>
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
