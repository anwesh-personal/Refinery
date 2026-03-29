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
import AISettingsPage from './pages/AISettings';
import LeadScoringPage from './pages/LeadScoring';
import ICPAnalysisPage from './pages/ICPAnalysis';
import ListSegmentationPage from './pages/ListSegmentation';
import BounceAnalysisPage from './pages/BounceAnalysis';
import DataEnrichmentPage from './pages/DataEnrichment';
import ContentGenerationPage from './pages/ContentGeneration';
import CampaignOptimizerPage from './pages/CampaignOptimizer';
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
                    <Route path="/ai-settings" element={<ProtectedRoute requires="canViewConfig"><AISettingsPage /></ProtectedRoute>} />
                    <Route path="/lead-scoring" element={<ProtectedRoute requires="canViewConfig"><LeadScoringPage /></ProtectedRoute>} />
                    <Route path="/icp-analysis" element={<ProtectedRoute requires="canViewConfig"><ICPAnalysisPage /></ProtectedRoute>} />
                    <Route path="/list-segmentation" element={<ProtectedRoute requires="canViewConfig"><ListSegmentationPage /></ProtectedRoute>} />
                    <Route path="/bounce-analysis" element={<ProtectedRoute requires="canViewConfig"><BounceAnalysisPage /></ProtectedRoute>} />
                    <Route path="/data-enrichment" element={<ProtectedRoute requires="canViewConfig"><DataEnrichmentPage /></ProtectedRoute>} />
                    <Route path="/content-generation" element={<ProtectedRoute requires="canViewConfig"><ContentGenerationPage /></ProtectedRoute>} />
                    <Route path="/campaign-optimizer" element={<ProtectedRoute requires="canViewConfig"><CampaignOptimizerPage /></ProtectedRoute>} />
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
