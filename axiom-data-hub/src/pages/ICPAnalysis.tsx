import { useState, useEffect } from 'react';
import { apiCall } from '../lib/api';
import {
  Sparkles, Loader2, ChevronDown, Settings, Target, AlertTriangle,
  TrendingUp, Zap, BarChart3, Users, Globe, Shield, Eye, Lightbulb
} from 'lucide-react';
import AgentCard from '../components/AgentCard';

// ─── Types ───

interface ICPConfig {
  analysisDepth: 'quick' | 'standard' | 'deep';
  focusAreas: {
    domainPatterns: boolean; roleAnalysis: boolean; providerDistribution: boolean;
    authQuality: boolean; geographicHints: boolean; riskCorrelation: boolean;
  };
  industry: string; targetAudience: string; customContext: string;
  includeClassifications: string[]; minRiskScore: number; maxLeads: number;
}

interface ICPSegment {
  name: string; description: string; matchPercentage: number; leadCount: number;
  sampleEmails: string[]; characteristics: string[]; recommendedAction: string;
}
interface ICPInsight {
  category: 'opportunity' | 'warning' | 'pattern' | 'recommendation';
  title: string; description: string; impact: 'high' | 'medium' | 'low';
}
interface DistItem { label: string; count: number; percentage: number }
interface ICPResult {
  profile: {
    summary: string; idealDomainTypes: string[]; idealRoles: string[];
    idealProviders: string[]; redFlags: string[]; strengthIndicators: string[];
  };
  segments: ICPSegment[];
  insights: ICPInsight[];
  distribution: {
    domainTypes: DistItem[]; roleTypes: DistItem[];
    providerTypes: DistItem[]; authQuality: DistItem[];
  };
  ai: { provider: string; model: string; latencyMs: number; wasFallback: boolean; tokensUsed?: number };
}
interface Job { id: string; status: string; totalProcessed: number; safe: number; uncertain: number; risky: number; rejected: number; results: any[] }

const INSIGHT_COLORS: Record<string, string> = {
  opportunity: '#10a37f', warning: '#ff6b35', pattern: '#4285f4', recommendation: '#8b5cf6',
};
const INSIGHT_ICONS: Record<string, string> = {
  opportunity: '🚀', warning: '⚠️', pattern: '🔍', recommendation: '💡',
};
const IMPACT_BADGE: Record<string, { bg: string; color: string }> = {
  high: { bg: '#ff6b3520', color: '#ff6b35' },
  medium: { bg: '#ffd70020', color: '#d4a800' },
  low: { bg: '#10a37f20', color: '#10a37f' },
};

const DEFAULT_CONFIG: ICPConfig = {
  analysisDepth: 'standard',
  focusAreas: { domainPatterns: true, roleAnalysis: true, providerDistribution: true, authQuality: true, geographicHints: true, riskCorrelation: true },
  industry: '', targetAudience: '', customContext: '',
  includeClassifications: ['safe', 'uncertain'], minRiskScore: 0, maxLeads: 200,
};

export default function ICPAnalysisPage() {
  const [toast, setToast] = useState<{ type: 'error' | 'warning' | 'info'; message: string } | null>(null);
  const showToast = (type: 'error' | 'warning' | 'info', message: string) => {
    setToast({ type, message: message.replace(/<[^>]*>/g, '').trim().slice(0, 200) });
    setTimeout(() => setToast(null), 6000);
  };

  const [config, setConfig] = useState<ICPConfig>(DEFAULT_CONFIG);
  const [showConfig, setShowConfig] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<ICPResult | null>(null);
  const [activeTab, setActiveTab] = useState<'profile' | 'segments' | 'insights' | 'distribution'>('profile');

  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [loadingJobs, setLoadingJobs] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiCall<{ jobs: Job[] }>('/api/verify/jobs');
        const completed = (data.jobs || []).filter(j => j.status === 'completed' && j.results?.length > 0);
        setJobs(completed);
        if (completed.length > 0) setSelectedJobId(completed[0].id);
      } catch (e: any) { showToast('error', e.message); }
      finally { setLoadingJobs(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedJob = jobs.find(j => j.id === selectedJobId);

  const runAnalysis = async () => {
    if (!selectedJob) return showToast('warning', 'No job selected');
    setAnalyzing(true); setResult(null);
    try {
      const leads = selectedJob.results.map((r: any) => ({
        email: r.email, classification: r.classification, riskScore: r.riskScore, checks: r.checks,
      }));
      const res = await apiCall<ICPResult>('/api/ai/icp-analysis', { method: 'POST', body: { leads, config } });
      setResult(res);
      showToast('info', `Analysis complete in ${res.ai.latencyMs}ms`);
    } catch (e: any) { showToast('error', e.message); }
    finally { setAnalyzing(false); }
  };

  if (loadingJobs) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '60vh', gap: 12 }}>
        <Target size={28} style={{ color: 'var(--accent)', animation: 'pulse 2s ease-in-out infinite' }} />
        <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Loading...</div>
      </div>
    );
  }

  return (
    <>
      {/* Hero */}
      <div style={{
        background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--bg-sidebar) 100%)',
        borderRadius: 20, border: '1px solid var(--border)', padding: '28px 32px',
        marginBottom: 24, position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -30, right: -30, width: 180, height: 180, borderRadius: '50%', background: '#4285f4', opacity: 0.04 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #4285f4 0%, #1a5bc4 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Target size={18} style={{ color: '#fff' }} />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>ICP Analysis</h1>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', maxWidth: 600, lineHeight: 1.6 }}>
          AI-powered Ideal Customer Profile analysis. Identifies patterns, segments, and actionable insights from your verified lead data.
        </p>
      </div>

      {/* Source + Controls */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, marginBottom: 20 }}>
        <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', padding: 18 }}>
          <label style={labelStyle}>Source — Verification Job</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <select value={selectedJobId} onChange={e => setSelectedJobId(e.target.value)} style={{ ...inputStyle, appearance: 'none', paddingRight: 28, cursor: 'pointer' }}>
                <option value="">Select a completed job...</option>
                {jobs.map(j => <option key={j.id} value={j.id}>Job {j.id.slice(0, 8)} — {j.totalProcessed} emails ({j.safe} safe, {j.uncertain} uncertain)</option>)}
              </select>
              <ChevronDown size={12} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-tertiary)' }} />
            </div>
            <button onClick={runAnalysis} disabled={analyzing || !selectedJobId} style={{
              padding: '10px 24px', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, #4285f4 0%, #1a5bc4 100%)', color: '#fff',
              fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6,
              opacity: (analyzing || !selectedJobId) ? 0.5 : 1, boxShadow: '0 4px 14px rgba(66,133,244,0.25)',
            }}>
              {analyzing ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Target size={14} />}
              {analyzing ? 'Analyzing...' : 'Analyze ICP'}
            </button>
          </div>
        </div>
        <button onClick={() => setShowConfig(!showConfig)} style={{
          background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)',
          padding: '18px 22px', cursor: 'pointer', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 6, minWidth: 100,
          color: showConfig ? 'var(--accent)' : 'var(--text-secondary)',
        }}>
          <Settings size={20} style={{ transition: 'transform 0.3s', transform: showConfig ? 'rotate(90deg)' : '' }} />
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Configure</span>
        </button>
      </div>

      {/* Config Panel */}
      {showConfig && (
        <div style={{
          background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--accent)',
          padding: 24, marginBottom: 24, animation: 'slideDown 0.2s ease-out',
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 18 }}>
            <Settings size={15} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Analysis Configuration
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16 }}>
            {/* Depth */}
            <div>
              <label style={labelStyle}>Analysis Depth</label>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['quick', 'standard', 'deep'] as const).map(d => (
                  <button key={d} onClick={() => setConfig(prev => ({ ...prev, analysisDepth: d }))} style={{
                    flex: 1, padding: '7px 0', borderRadius: 7, border: `1px solid ${config.analysisDepth === d ? 'var(--accent)' : 'var(--border)'}`,
                    background: config.analysisDepth === d ? 'var(--accent)' : 'transparent',
                    color: config.analysisDepth === d ? '#fff' : 'var(--text-secondary)',
                    fontSize: 11, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize',
                  }}>{d}</button>
                ))}
              </div>
            </div>
            {/* Industry */}
            <div>
              <label style={labelStyle}>Industry</label>
              <input value={config.industry} onChange={e => setConfig(prev => ({ ...prev, industry: e.target.value }))} placeholder="e.g. SaaS, E-commerce, Healthcare" style={inputStyle} />
            </div>
            {/* Target Audience */}
            <div>
              <label style={labelStyle}>Target Audience</label>
              <input value={config.targetAudience} onChange={e => setConfig(prev => ({ ...prev, targetAudience: e.target.value }))} placeholder="e.g. CTOs at mid-market SaaS companies" style={inputStyle} />
            </div>
            {/* Max Leads */}
            <div>
              <label style={labelStyle}>Max Leads to Analyze</label>
              <input type="number" min={10} max={500} value={config.maxLeads} onChange={e => setConfig(prev => ({ ...prev, maxLeads: Number(e.target.value) }))} style={{ ...inputStyle, maxWidth: 100 }} />
            </div>
          </div>

          {/* Focus Areas */}
          <div style={{ marginTop: 16, marginBottom: 16 }}>
            <div style={{ ...labelStyle, marginBottom: 8 }}>Focus Areas</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 6 }}>
              {Object.entries(config.focusAreas).map(([key, val]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, color: 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={val} onChange={e => setConfig(prev => ({ ...prev, focusAreas: { ...prev.focusAreas, [key]: e.target.checked } }))} style={{ accentColor: 'var(--accent)' }} />
                  {key.replace(/([A-Z])/g, ' $1').trim()}
                </label>
              ))}
            </div>
          </div>

          {/* Include Classifications */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ ...labelStyle, marginBottom: 8 }}>Include Classifications</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {['safe', 'uncertain', 'risky', 'reject'].map(c => (
                <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={config.includeClassifications.includes(c)}
                    onChange={e => setConfig(prev => ({
                      ...prev,
                      includeClassifications: e.target.checked ? [...prev.includeClassifications, c] : prev.includeClassifications.filter(x => x !== c)
                    }))} style={{ accentColor: 'var(--accent)' }} />
                  {c}
                </label>
              ))}
            </div>
          </div>

          {/* Custom Context */}
          <div>
            <label style={labelStyle}>Custom Context</label>
            <textarea value={config.customContext} onChange={e => setConfig(prev => ({ ...prev, customContext: e.target.value }))}
              placeholder="Any additional context for the AI to consider..." rows={2}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
          </div>
        </div>
      )}

      {/* ── Results ── */}
      {result && (
        <>
          {/* Result Tabs */}
          <div style={{ display: 'flex', gap: 2, marginBottom: 16, background: 'var(--bg-card)', borderRadius: 10, padding: 3, border: '1px solid var(--border)', width: 'fit-content' }}>
            {([
              { key: 'profile' as const, label: 'ICP Profile', icon: <Target size={12} /> },
              { key: 'segments' as const, label: `Segments (${result.segments?.length || 0})`, icon: <Users size={12} /> },
              { key: 'insights' as const, label: `Insights (${result.insights?.length || 0})`, icon: <Lightbulb size={12} /> },
              { key: 'distribution' as const, label: 'Distribution', icon: <BarChart3 size={12} /> },
            ]).map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
                padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: activeTab === t.key ? 'var(--accent)' : 'transparent',
                color: activeTab === t.key ? '#fff' : 'var(--text-tertiary)',
                fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
              }}>{t.icon} {t.label}</button>
            ))}
          </div>

          {/* AI Meta Bar */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, fontSize: 10, color: 'var(--text-tertiary)' }}>
            <span><Zap size={10} style={{ verticalAlign: 'middle' }} /> {result.ai.latencyMs}ms</span>
            <span>🤖 {result.ai.provider} → {result.ai.model}</span>
            {result.ai.tokensUsed && <span>📊 {result.ai.tokensUsed} tokens</span>}
            {result.ai.wasFallback && <span style={{ color: 'var(--yellow)' }}>⚡ Fallback used</span>}
          </div>

          {/* ── Profile Tab ── */}
          {activeTab === 'profile' && result.profile && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Summary */}
              <div style={{
                background: 'linear-gradient(135deg, #4285f410 0%, #1a5bc410 100%)',
                borderRadius: 16, border: '1px solid #4285f430', padding: 22,
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#4285f4', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
                  <Target size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} /> ICP Summary
                </div>
                <div style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.7, fontWeight: 500 }}>
                  {result.profile.summary}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
                {/* Ideal Domains */}
                <ProfileCard title="Ideal Domain Types" icon={<Globe size={14} />} color="#10a37f" items={result.profile.idealDomainTypes} />
                {/* Ideal Roles */}
                <ProfileCard title="Ideal Roles" icon={<Users size={14} />} color="#4285f4" items={result.profile.idealRoles} />
                {/* Ideal Providers */}
                <ProfileCard title="Ideal Providers" icon={<Shield size={14} />} color="#8b5cf6" items={result.profile.idealProviders} />
                {/* Strength Indicators */}
                <ProfileCard title="Strength Indicators" icon={<TrendingUp size={14} />} color="#ffd700" items={result.profile.strengthIndicators} />
                {/* Red Flags */}
                <ProfileCard title="Red Flags" icon={<AlertTriangle size={14} />} color="#ff6b35" items={result.profile.redFlags} />
              </div>
            </div>
          )}

          {/* ── Segments Tab ── */}
          {activeTab === 'segments' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 14 }}>
              {(result.segments || []).map((seg, i) => (
                <div key={i} style={{
                  background: 'var(--bg-card)', borderRadius: 14, overflow: 'hidden',
                  border: `1px solid var(--border)`, transition: 'transform 0.15s, box-shadow 0.15s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 25px rgba(0,0,0,0.1)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
                >
                  {/* Match bar */}
                  <div style={{ height: 4, background: 'var(--bg-app)' }}>
                    <div style={{
                      height: '100%', width: `${seg.matchPercentage}%`,
                      background: seg.matchPercentage >= 80 ? '#10a37f' : seg.matchPercentage >= 50 ? '#ffd700' : '#ff6b35',
                      borderRadius: 2, transition: 'width 0.5s ease',
                    }} />
                  </div>
                  <div style={{ padding: '16px 18px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{seg.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{seg.description}</div>
                      </div>
                      <div style={{
                        padding: '6px 12px', borderRadius: 10, textAlign: 'center',
                        background: seg.matchPercentage >= 80 ? '#10a37f15' : seg.matchPercentage >= 50 ? '#ffd70015' : '#ff6b3515',
                        border: `1px solid ${seg.matchPercentage >= 80 ? '#10a37f' : seg.matchPercentage >= 50 ? '#ffd700' : '#ff6b35'}40`,
                      }}>
                        <div style={{ fontSize: 18, fontWeight: 900, color: seg.matchPercentage >= 80 ? '#10a37f' : seg.matchPercentage >= 50 ? '#d4a800' : '#ff6b35' }}>{seg.matchPercentage}%</div>
                        <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>Match</div>
                      </div>
                    </div>

                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 8 }}>~{seg.leadCount} leads</div>

                    {/* Characteristics */}
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                      {seg.characteristics.map(c => (
                        <span key={c} style={{ padding: '2px 7px', borderRadius: 4, fontSize: 9, fontWeight: 600, background: 'var(--bg-app)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>{c}</span>
                      ))}
                    </div>

                    {/* Sample emails */}
                    {seg.sampleEmails?.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 3 }}>
                          <Eye size={9} style={{ verticalAlign: 'middle' }} /> Samples
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
                          {seg.sampleEmails.join(', ')}
                        </div>
                      </div>
                    )}

                    {/* Recommended action */}
                    <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--accent-muted)', fontSize: 11, color: 'var(--text-secondary)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                      <Sparkles size={12} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
                      {seg.recommendedAction}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Insights Tab ── */}
          {activeTab === 'insights' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(result.insights || []).map((ins, i) => (
                <div key={i} style={{
                  background: 'var(--bg-card)', borderRadius: 12, padding: '14px 18px',
                  border: `1px solid ${INSIGHT_COLORS[ins.category]}30`,
                  display: 'grid', gridTemplateColumns: '30px 1fr auto', gap: 12, alignItems: 'center',
                }}>
                  <span style={{ fontSize: 20 }}>{INSIGHT_ICONS[ins.category]}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{ins.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.5 }}>{ins.description}</div>
                  </div>
                  <div style={{
                    padding: '3px 8px', borderRadius: 5, fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                    background: IMPACT_BADGE[ins.impact].bg, color: IMPACT_BADGE[ins.impact].color,
                  }}>{ins.impact}</div>
                </div>
              ))}
            </div>
          )}

          {/* ── Distribution Tab ── */}
          {activeTab === 'distribution' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
              {([
                { key: 'domainTypes', title: 'Domain Types', icon: <Globe size={14} />, color: '#4285f4' },
                { key: 'roleTypes', title: 'Role Distribution', icon: <Users size={14} />, color: '#10a37f' },
                { key: 'providerTypes', title: 'Email Providers', icon: <Shield size={14} />, color: '#8b5cf6' },
                { key: 'authQuality', title: 'Auth Quality', icon: <Shield size={14} />, color: '#ffd700' },
              ] as const).map(dist => {
                const items = result.distribution?.[dist.key] || [];
                return (
                  <div key={dist.key} style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', padding: 18 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {dist.icon} {dist.title}
                    </div>
                    {items.map(item => (
                      <div key={item.label} style={{ marginBottom: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                          <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{item.label}</span>
                          <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>{item.count} ({item.percentage}%)</span>
                        </div>
                        <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-app)' }}>
                          <div style={{ height: '100%', borderRadius: 3, width: `${item.percentage}%`, background: dist.color, transition: 'width 0.4s ease' }} />
                        </div>
                      </div>
                    ))}
                    {items.length === 0 && <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>No data</div>}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {!result && !analyzing && jobs.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: 'var(--bg-card)', borderRadius: 20, border: '1px dashed var(--border)' }}>
          <AlertTriangle size={32} style={{ color: 'var(--text-tertiary)', marginBottom: 12, opacity: 0.4 }} />
          <div style={{ fontSize: 14, color: 'var(--text-tertiary)', fontWeight: 500 }}>No verification jobs found</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', opacity: 0.6, marginTop: 4 }}>Run a verification pipeline first.</div>
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          padding: '14px 22px', borderRadius: 12, maxWidth: 420,
          background: toast.type === 'error' ? 'var(--red)' : toast.type === 'warning' ? 'var(--yellow)' : 'var(--accent)',
          color: '#fff', fontSize: 12, fontWeight: 600, boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
          animation: 'slideUp 0.25s ease-out', cursor: 'pointer',
        }} onClick={() => setToast(null)}>
          {toast.type === 'error' ? '❌' : toast.type === 'warning' ? '⚠️' : 'ℹ️'} {toast.message}
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes slideDown { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* AI Agent */}
      <div style={{ marginTop: 36 }}>
        <AgentCard slug="data_scientist" contextLabel="Ideal Customer Profile Analysis" />
      </div>
    </>
  );
}

// ─── Sub-components ───

function ProfileCard({ title, icon, color, items }: { title: string; icon: React.ReactNode; color: string; items: string[] }) {
  return (
    <div style={{
      background: 'var(--bg-card)', borderRadius: 12, border: `1px solid ${color}25`,
      padding: 16,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
        {icon} {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(items || []).map(item => (
          <div key={item} style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 4, height: 4, borderRadius: '50%', background: color, flexShrink: 0 }} />
            {item}
          </div>
        ))}
        {(!items || items.length === 0) && <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>None identified</div>}
      </div>
    </div>
  );
}

// ─── Styles ───
const labelStyle: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase',
  letterSpacing: 0.8, display: 'block', marginBottom: 4,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 11px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12,
};
