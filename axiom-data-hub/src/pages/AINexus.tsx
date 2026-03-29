import { useSearchParams } from 'react-router-dom';
import {
  Sparkles, Target, Layers, Activity, Database, Rocket,
  Brain, Settings2, LayoutDashboard, GitBranch
} from 'lucide-react';

import AIDashboardPage from './AIDashboard';
import LeadScoringPage from './LeadScoring';
import ICPAnalysisPage from './ICPAnalysis';
import ListSegmentationPage from './ListSegmentation';
import BounceAnalysisPage from './BounceAnalysis';
import DataEnrichmentPage from './DataEnrichment';

import CampaignOptimizerPage from './CampaignOptimizer';
import AISettingsPage from './AISettings';
import AgentsPanel from '../components/AgentsPanel';
import AIArchitecture from '../components/AIArchitecture';

const TABS = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'agents', label: 'Agents', icon: Brain },
  { key: 'lead-scoring', label: 'Lead Scoring', icon: Sparkles },
  { key: 'icp-analysis', label: 'ICP Analysis', icon: Target },
  { key: 'list-segmentation', label: 'Segmentation', icon: Layers },
  { key: 'bounce-analysis', label: 'Bounce', icon: Activity },
  { key: 'data-enrichment', label: 'Enrichment', icon: Database },
  { key: 'campaign-optimizer', label: 'Optimizer', icon: Rocket },
  { key: 'architecture', label: 'Architecture', icon: GitBranch },
  { key: 'settings', label: 'Settings', icon: Settings2 },
];

export default function AINexusPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'dashboard';
  const setTab = (t: string) => setSearchParams({ tab: t });

  return (
    <>
      <div style={{ display: 'flex', gap: 2, marginBottom: 20, background: 'var(--bg-card)', borderRadius: 12, padding: 4, border: '1px solid var(--border)', overflowX: 'auto', scrollbarWidth: 'none' }}>
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding: '8px 14px', borderRadius: 9, border: active ? '1px solid var(--accent)' : '1px solid transparent', cursor: 'pointer', whiteSpace: 'nowrap',
              background: active ? 'var(--accent-muted)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--text-tertiary)',
              fontSize: 11, fontWeight: active ? 700 : 600, display: 'flex', alignItems: 'center', gap: 5,
              transition: 'all 0.15s ease', flexShrink: 0,
            }}><Icon size={13} /> {t.label}</button>
          );
        })}
      </div>

      {tab === 'dashboard' && <AIDashboardPage />}
      {tab === 'agents' && <AgentsPanel />}
      {tab === 'lead-scoring' && <LeadScoringPage />}
      {tab === 'icp-analysis' && <ICPAnalysisPage />}
      {tab === 'list-segmentation' && <ListSegmentationPage />}
      {tab === 'bounce-analysis' && <BounceAnalysisPage />}
      {tab === 'data-enrichment' && <DataEnrichmentPage />}
      {tab === 'campaign-optimizer' && <CampaignOptimizerPage />}
      {tab === 'architecture' && <AIArchitecture />}
      {tab === 'settings' && <AISettingsPage />}
    </>
  );
}
