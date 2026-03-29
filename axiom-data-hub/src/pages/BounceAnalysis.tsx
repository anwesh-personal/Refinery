import { useState, useEffect } from 'react';
import { apiCall } from '../lib/api';
import {
  Loader2, ChevronDown, Settings, Activity, AlertTriangle,
  Zap, Shield, TrendingDown, CheckCircle, XCircle, Download
} from 'lucide-react';

interface BounceConfig {
  analysisMode: string; focusAreas: Record<string, boolean>;
  riskTolerance: string; campaignType: string; senderReputation: string;
  customContext: string; includeClassifications: string[]; maxLeads: number;
}
interface DomainHealth { domain: string; leadCount: number; healthScore: number; predictedBounceRate: string; riskLevel: string; issues: string[]; recommendations: string[] }
interface Pattern { category: string; finding: string; affectedCount: number; severity: string; action: string }
interface Recommendation { priority: string; title: string; description: string; estimatedImpact: string }
interface RiskItem { label: string; count: number; percentage: number; color: string }
interface BounceResult {
  overview: { totalAnalyzed: number; predictedBounceRate: string; predictedHardBounces: number; predictedSoftBounces: number; safeToSend: number; needsReview: number; doNotSend: number; overallRisk: string };
  domainHealth: DomainHealth[]; patterns: Pattern[]; recommendations: Recommendation[]; riskBreakdown: RiskItem[];
  ai: { provider: string; model: string; latencyMs: number; wasFallback: boolean; tokensUsed?: number };
}
interface Job { id: string; status: string; totalProcessed: number; safe: number; uncertain: number; risky: number; results: any[] }

const RISK_BG: Record<string, string> = { low: '#10a37f15', medium: '#ffd70015', high: '#ff6b3515', critical: '#ef444415' };
const RISK_COLOR: Record<string, string> = { low: '#10a37f', medium: '#d4a800', high: '#ff6b35', critical: '#ef4444' };
const SEV_COLOR: Record<string, string> = { info: '#4285f4', warning: '#ffd700', critical: '#ef4444' };
const PRIO_COLOR: Record<string, string> = { immediate: '#ef4444', before_send: '#ff6b35', ongoing: '#4285f4' };

const DEFAULT_CONFIG: BounceConfig = {
  analysisMode: 'pre_send', focusAreas: { smtpPatterns: true, domainHealth: true, infrastructureRisk: true, catchAllRisk: true, providerAnalysis: true, temporalPatterns: true },
  riskTolerance: 'balanced', campaignType: '', senderReputation: 'established',
  customContext: '', includeClassifications: ['safe', 'uncertain', 'risky'], maxLeads: 300,
};

export default function BounceAnalysisPage() {
  const [toast, setToast] = useState<{ type: string; message: string } | null>(null);
  const showToast = (type: string, message: string) => { setToast({ type, message: message.slice(0, 200) }); setTimeout(() => setToast(null), 6000); };
  const [config, setConfig] = useState<BounceConfig>(DEFAULT_CONFIG);
  const [showConfig, setShowConfig] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<BounceResult | null>(null);
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [jobs, setJobs] = useState<Job[]>([]); const [selectedJobId, setSelectedJobId] = useState(''); const [loadingJobs, setLoadingJobs] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const d = await apiCall<{ jobs: Job[] }>('/api/verify/jobs');
        const c = (d.jobs || []).filter(j => j.status === 'completed' && j.results?.length > 0);
        setJobs(c); if (c.length > 0) setSelectedJobId(c[0].id);
      } catch (e: any) { showToast('error', e.message); } finally { setLoadingJobs(false); }
    })();
  }, []);

  const selectedJob = jobs.find(j => j.id === selectedJobId);

  const run = async () => {
    if (!selectedJob) return showToast('warning', 'No job selected');
    setAnalyzing(true); setResult(null);
    try {
      const leads = selectedJob.results.map((r: any) => ({ email: r.email, classification: r.classification, riskScore: r.riskScore, checks: r.checks }));
      const res = await apiCall<BounceResult>('/api/ai/bounce-analysis', { method: 'POST', body: { leads, config } });
      setResult(res); showToast('info', `Analyzed in ${res.ai.latencyMs}ms`);
    } catch (e: any) { showToast('error', e.message); } finally { setAnalyzing(false); }
  };

  if (loadingJobs) return <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '60vh', gap: 12 }}><Activity size={28} style={{ color: 'var(--accent)', animation: 'pulse 2s ease-in-out infinite' }} /><div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Loading...</div></div>;

  return (
    <>
      {/* Hero */}
      <div style={{ background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--bg-sidebar) 100%)', borderRadius: 20, border: '1px solid var(--border)', padding: '28px 32px', marginBottom: 24, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -30, right: -30, width: 180, height: 180, borderRadius: '50%', background: '#ef4444', opacity: 0.04 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Activity size={18} style={{ color: '#fff' }} /></div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Bounce Analysis</h1>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', maxWidth: 600, lineHeight: 1.6 }}>Pre-send deliverability prediction. Identifies bounce risks, domain health issues, and provides actionable recommendations.</p>
      </div>

      {/* Source */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, marginBottom: 20 }}>
        <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', padding: 18 }}>
          <label style={labelStyle}>Source — Verification Job</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <select value={selectedJobId} onChange={e => setSelectedJobId(e.target.value)} style={{ ...inputStyle, appearance: 'none', paddingRight: 28, cursor: 'pointer' }}>
                <option value="">Select...</option>{jobs.map(j => <option key={j.id} value={j.id}>Job {j.id.slice(0, 8)} — {j.totalProcessed} emails</option>)}
              </select>
              <ChevronDown size={12} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-tertiary)' }} />
            </div>
            <button onClick={run} disabled={analyzing || !selectedJobId} style={{ padding: '10px 24px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)', color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, opacity: (analyzing || !selectedJobId) ? 0.5 : 1 }}>
              {analyzing ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Activity size={14} />} {analyzing ? 'Analyzing...' : 'Analyze Bounces'}
            </button>
          </div>
        </div>
        <button onClick={() => setShowConfig(!showConfig)} style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', padding: '18px 22px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, minWidth: 100, color: showConfig ? 'var(--accent)' : 'var(--text-secondary)' }}>
          <Settings size={20} style={{ transition: 'transform 0.3s', transform: showConfig ? 'rotate(90deg)' : '' }} /><span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Configure</span>
        </button>
      </div>

      {/* Config */}
      {showConfig && (
        <div style={{ background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--accent)', padding: 24, marginBottom: 24, animation: 'slideDown 0.2s ease-out' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 18 }}><Settings size={15} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Bounce Analysis Config</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
            <div><label style={labelStyle}>Risk Tolerance</label>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['conservative', 'balanced', 'aggressive'] as const).map(r => (
                  <button key={r} onClick={() => setConfig(p => ({ ...p, riskTolerance: r }))} style={{ flex: 1, padding: '7px 0', borderRadius: 7, border: `1px solid ${config.riskTolerance === r ? '#ef4444' : 'var(--border)'}`, background: config.riskTolerance === r ? '#ef4444' : 'transparent', color: config.riskTolerance === r ? '#fff' : 'var(--text-secondary)', fontSize: 10, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' }}>{r}</button>
                ))}
              </div>
            </div>
            <div><label style={labelStyle}>Sender Reputation</label>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['new', 'warm', 'established'] as const).map(s => (
                  <button key={s} onClick={() => setConfig(p => ({ ...p, senderReputation: s }))} style={{ flex: 1, padding: '7px 0', borderRadius: 7, border: `1px solid ${config.senderReputation === s ? '#ef4444' : 'var(--border)'}`, background: config.senderReputation === s ? '#ef4444' : 'transparent', color: config.senderReputation === s ? '#fff' : 'var(--text-secondary)', fontSize: 10, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' }}>{s}</button>
                ))}
              </div>
            </div>
            <div><label style={labelStyle}>Campaign Type</label><input value={config.campaignType} onChange={e => setConfig(p => ({ ...p, campaignType: e.target.value }))} placeholder="cold outreach, newsletter..." style={inputStyle} /></div>
            <div><label style={labelStyle}>Max Leads</label><input type="number" min={10} max={500} value={config.maxLeads} onChange={e => setConfig(p => ({ ...p, maxLeads: Number(e.target.value) }))} style={{ ...inputStyle, maxWidth: 100 }} /></div>
          </div>
          <div style={{ marginTop: 14 }}><div style={{ ...labelStyle, marginBottom: 6 }}>Focus Areas</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 6 }}>
              {Object.entries(config.focusAreas).map(([k, v]) => (
                <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, color: 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={v} onChange={e => setConfig(p => ({ ...p, focusAreas: { ...p.focusAreas, [k]: e.target.checked } }))} style={{ accentColor: '#ef4444' }} />{k.replace(/([A-Z])/g, ' $1').trim()}
                </label>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 14 }}><div style={{ ...labelStyle, marginBottom: 6 }}>Include</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {['safe', 'uncertain', 'risky', 'reject'].map(c => (
                <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={config.includeClassifications.includes(c)} onChange={e => setConfig(p => ({ ...p, includeClassifications: e.target.checked ? [...p.includeClassifications, c] : p.includeClassifications.filter(x => x !== c) }))} style={{ accentColor: '#ef4444' }} />{c}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 2, marginBottom: 16, background: 'var(--bg-card)', borderRadius: 10, padding: 3, border: '1px solid var(--border)', width: 'fit-content' }}>
            {[{ k: 'overview', l: 'Overview' }, { k: 'domains', l: `Domains (${result.domainHealth?.length || 0})` }, { k: 'patterns', l: `Patterns (${result.patterns?.length || 0})` }, { k: 'actions', l: 'Actions' }].map(t => (
              <button key={t.k} onClick={() => setActiveTab(t.k)} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: activeTab === t.k ? '#ef4444' : 'transparent', color: activeTab === t.k ? '#fff' : 'var(--text-tertiary)', fontSize: 11, fontWeight: 600 }}>{t.l}</button>
            ))}
          </div>

          {/* Overview */}
          {activeTab === 'overview' && result.overview && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Risk Banner */}
              <div style={{ background: RISK_BG[result.overview.overallRisk] || RISK_BG.medium, borderRadius: 16, border: `1px solid ${RISK_COLOR[result.overview.overallRisk] || RISK_COLOR.medium}40`, padding: 22, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: RISK_COLOR[result.overview.overallRisk], textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>Overall Risk: {result.overview.overallRisk}</div>
                  <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--text-primary)' }}>{result.overview.predictedBounceRate}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Predicted Bounce Rate</div>
                </div>
                <div style={{ display: 'flex', gap: 16 }}>
                  <StatBox icon={<CheckCircle size={14} />} value={result.overview.safeToSend} label="Safe" color="#10a37f" />
                  <StatBox icon={<AlertTriangle size={14} />} value={result.overview.needsReview} label="Review" color="#ffd700" />
                  <StatBox icon={<XCircle size={14} />} value={result.overview.doNotSend} label="Don't Send" color="#ef4444" />
                </div>
              </div>
              {/* Bounce breakdown */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
                <StatCard label="Total Analyzed" value={result.overview.totalAnalyzed} />
                <StatCard label="Hard Bounces" value={result.overview.predictedHardBounces} color="#ef4444" />
                <StatCard label="Soft Bounces" value={result.overview.predictedSoftBounces} color="#ff6b35" />
              </div>
              {/* Risk Breakdown bars */}
              {result.riskBreakdown?.length > 0 && (
                <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', padding: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>Risk Distribution</div>
                  {result.riskBreakdown.map(r => (
                    <div key={r.label} style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>{r.label}</span>
                        <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>{r.count} ({r.percentage}%)</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-app)' }}>
                        <div style={{ height: '100%', borderRadius: 3, width: `${r.percentage}%`, background: r.color, transition: 'width 0.4s ease' }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Domains */}
          {activeTab === 'domains' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 10 }}>
              {(result.domainHealth || []).map((d, i) => (
                <div key={i} style={{ background: 'var(--bg-card)', borderRadius: 12, border: `1px solid ${RISK_COLOR[d.riskLevel] || 'var(--border)'}30`, overflow: 'hidden' }}>
                  <div style={{ height: 4, background: 'var(--bg-app)' }}><div style={{ height: '100%', width: `${d.healthScore}%`, background: d.healthScore >= 70 ? '#10a37f' : d.healthScore >= 40 ? '#ffd700' : '#ef4444', borderRadius: 2 }} /></div>
                  <div style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div><div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{d.domain}</div><div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{d.leadCount} leads · {d.predictedBounceRate} bounce</div></div>
                      <div style={{ width: 42, height: 42, borderRadius: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: d.healthScore >= 70 ? '#10a37f15' : d.healthScore >= 40 ? '#ffd70015' : '#ef444415', border: `1px solid ${d.healthScore >= 70 ? '#10a37f' : d.healthScore >= 40 ? '#ffd700' : '#ef4444'}40` }}>
                        <div style={{ fontSize: 16, fontWeight: 900, color: d.healthScore >= 70 ? '#10a37f' : d.healthScore >= 40 ? '#d4a800' : '#ef4444' }}>{d.healthScore}</div>
                      </div>
                    </div>
                    {d.issues.length > 0 && <div style={{ marginBottom: 6 }}>{d.issues.map((is, j) => <div key={j} style={{ fontSize: 10, color: '#ef4444', display: 'flex', gap: 4, marginBottom: 2 }}><XCircle size={10} style={{ flexShrink: 0, marginTop: 1 }} /> {is}</div>)}</div>}
                    {d.recommendations.length > 0 && <div>{d.recommendations.map((r, j) => <div key={j} style={{ fontSize: 10, color: 'var(--text-secondary)', display: 'flex', gap: 4, marginBottom: 2 }}><Shield size={10} style={{ color: '#4285f4', flexShrink: 0, marginTop: 1 }} /> {r}</div>)}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Patterns */}
          {activeTab === 'patterns' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(result.patterns || []).map((p, i) => (
                <div key={i} style={{ background: 'var(--bg-card)', borderRadius: 12, padding: '14px 18px', border: `1px solid ${SEV_COLOR[p.severity] || 'var(--border)'}30`, display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: SEV_COLOR[p.severity], textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>{p.category} · {p.severity}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>{p.finding}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Action: {p.action}</div>
                  </div>
                  <div style={{ textAlign: 'center' }}><div style={{ fontSize: 18, fontWeight: 900, color: SEV_COLOR[p.severity] }}>{p.affectedCount}</div><div style={{ fontSize: 8, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Affected</div></div>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          {activeTab === 'actions' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(result.recommendations || []).map((r, i) => (
                <div key={i} style={{ background: 'var(--bg-card)', borderRadius: 12, padding: '14px 18px', border: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '6px 1fr', gap: 14, overflow: 'hidden' }}>
                  <div style={{ background: PRIO_COLOR[r.priority] || '#888', borderRadius: 3 }} />
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{r.title}</div>
                      <span style={{ padding: '2px 8px', borderRadius: 5, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', background: `${PRIO_COLOR[r.priority]}15`, color: PRIO_COLOR[r.priority] }}>{r.priority.replace('_', ' ')}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 4 }}>{r.description}</div>
                    <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}><TrendingDown size={10} style={{ verticalAlign: 'middle' }} /> Impact: {r.estimatedImpact}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* AI Meta */}
          <div style={{ display: 'flex', gap: 12, marginTop: 16, fontSize: 10, color: 'var(--text-tertiary)' }}>
            <span><Zap size={10} style={{ verticalAlign: 'middle' }} /> {result.ai.latencyMs}ms</span>
            <span>🤖 {result.ai.provider} → {result.ai.model}</span>
            {result.ai.tokensUsed && <span>📊 {result.ai.tokensUsed} tokens</span>}
          </div>
        </>
      )}

      {!result && !analyzing && jobs.length === 0 && <EmptyState />}
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}@keyframes slideDown{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}@keyframes slideUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </>
  );
}

function StatBox({ icon, value, label, color }: { icon: React.ReactNode; value: number; label: string; color: string }) {
  return <div style={{ textAlign: 'center' }}>{icon}<div style={{ fontSize: 24, fontWeight: 900, color }}>{value}</div><div style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>{label}</div></div>;
}
function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 14, textAlign: 'center' }}><div style={{ fontSize: 22, fontWeight: 900, color: color || 'var(--text-primary)' }}>{value}</div><div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>{label}</div></div>;
}
function EmptyState() {
  return <div style={{ textAlign: 'center', padding: '60px 20px', background: 'var(--bg-card)', borderRadius: 20, border: '1px dashed var(--border)' }}><AlertTriangle size={32} style={{ color: 'var(--text-tertiary)', marginBottom: 12, opacity: 0.4 }} /><div style={{ fontSize: 14, color: 'var(--text-tertiary)', fontWeight: 500 }}>No verification jobs found</div></div>;
}
function Toast({ toast, onClose }: { toast: { type: string; message: string }; onClose: () => void }) {
  return <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, padding: '14px 22px', borderRadius: 12, maxWidth: 420, background: toast.type === 'error' ? 'var(--red)' : 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 600, boxShadow: '0 10px 30px rgba(0,0,0,0.3)', animation: 'slideUp 0.25s ease-out', cursor: 'pointer' }} onClick={onClose}>{toast.type === 'error' ? '❌' : 'ℹ️'} {toast.message}</div>;
}
const labelStyle: React.CSSProperties = { fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.8, display: 'block', marginBottom: 4 };
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12 };
