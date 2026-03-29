import { useState, useEffect } from 'react';
import { apiCall } from '../lib/api';
import {
  Sparkles, Loader2, ChevronDown, Settings, Trophy,
  AlertTriangle, TrendingUp, Zap, BarChart3, Target, Download
} from 'lucide-react';
import AgentCard from '../components/AgentCard';

// ─── Types ───

interface ScoringConfig {
  weights: { verificationStatus: number; domainReputation: number; deliverability: number; businessValue: number; blacklistStatus: number };
  tiers: { platinum: number; gold: number; silver: number; bronze: number };
  customInstructions: string;
  b2bMode: boolean;
  includeReasoning: boolean;
  batchSize: number;
}

interface ScoredLead {
  email: string;
  score: number;
  tier: 'platinum' | 'gold' | 'silver' | 'bronze' | 'dead';
  reasoning: string;
  signals: string[];
  recommendation: string;
}

interface ScoringResult {
  leads: ScoredLead[];
  summary: {
    totalScored: number;
    tierBreakdown: Record<string, number>;
    avgScore: number;
    topSignals: string[];
    recommendations: string[];
  };
  ai: { provider: string; model: string; latencyMs: number; wasFallback: boolean; tokensUsed?: number };
}

interface VerificationJob {
  id: string;
  status: string;
  totalInput: number;
  totalProcessed: number;
  safe: number;
  uncertain: number;
  risky: number;
  rejected: number;
  results: any[];
}

const TIER_COLORS: Record<string, string> = {
  platinum: '#c0c0e0', gold: 'var(--yellow)', silver: '#c0c0c0', bronze: 'var(--yellow)', dead: 'var(--text-tertiary)',
};
const TIER_GRADIENTS: Record<string, string> = {
  platinum: 'linear-gradient(135deg, var(--purple) 0%, color-mix(in srgb, var(--purple) 70%, #000) 100%)',
  gold: 'linear-gradient(135deg, color-mix(in srgb, var(--yellow) 80%, #000) 0%, #f12711 100%)',
  silver: 'linear-gradient(135deg, var(--text-tertiary) 0%, color-mix(in srgb, var(--text-tertiary) 70%, #000) 100%)',
  bronze: 'linear-gradient(135deg, var(--yellow) 0%, color-mix(in srgb, var(--yellow) 60%, #000) 100%)',
  dead: 'linear-gradient(135deg, var(--text-tertiary) 0%, color-mix(in srgb, var(--text-tertiary) 50%, #000) 100%)',
};

const DEFAULT_CONFIG: ScoringConfig = {
  weights: { verificationStatus: 8, domainReputation: 7, deliverability: 9, businessValue: 6, blacklistStatus: 10 },
  tiers: { platinum: 90, gold: 75, silver: 55, bronze: 35 },
  customInstructions: '',
  b2bMode: false,
  includeReasoning: true,
  batchSize: 50,
};

export default function LeadScoringPage() {
  const [toast, setToast] = useState<{ type: 'error' | 'warning' | 'info'; message: string } | null>(null);
  const showToast = (type: 'error' | 'warning' | 'info', message: string) => {
    setToast({ type, message: message.replace(/<[^>]*>/g, '').trim().slice(0, 200) });
    setTimeout(() => setToast(null), 6000);
  };

  const [config, setConfig] = useState<ScoringConfig>(DEFAULT_CONFIG);
  const [showConfig, setShowConfig] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [result, setResult] = useState<ScoringResult | null>(null);
  const [filterTier, setFilterTier] = useState<string>('all');

  // Job selection
  const [jobs, setJobs] = useState<VerificationJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [loadingJobs, setLoadingJobs] = useState(true);

  // Load completed verification jobs
  useEffect(() => {
    (async () => {
      try {
        const data = await apiCall<{ jobs: VerificationJob[] }>('/api/verify/jobs');
        const completed = (data.jobs || []).filter(j => j.status === 'completed' && j.results && j.results.length > 0);
        setJobs(completed);
        if (completed.length > 0) setSelectedJobId(completed[0].id);
      } catch (e: any) { showToast('error', e.message); }
      finally { setLoadingJobs(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedJob = jobs.find(j => j.id === selectedJobId);

  const runScoring = async () => {
    if (!selectedJob) return showToast('warning', 'No job selected');
    setScoring(true); setResult(null);
    try {
      const leads = selectedJob.results.map((r: any) => ({
        email: r.email,
        classification: r.classification,
        riskScore: r.riskScore,
        checks: r.checks,
      }));
      const scored = await apiCall<ScoringResult>('/api/ai/lead-scoring', {
        method: 'POST',
        body: { leads, config },
      });
      setResult(scored);
      showToast('info', `Scored ${scored.summary.totalScored} leads in ${scored.ai.latencyMs}ms`);
    } catch (e: any) { showToast('error', e.message); }
    finally { setScoring(false); }
  };

  const exportCSV = () => {
    if (!result) return;
    const rows = [['Email', 'Score', 'Tier', 'Signals', 'Reasoning', 'Recommendation'].join(',')];
    for (const l of result.leads) {
      rows.push([
        l.email, String(l.score), l.tier,
        `"${l.signals.join('; ')}"`, `"${(l.reasoning || '').replace(/"/g, '""')}"`,
        `"${(l.recommendation || '').replace(/"/g, '""')}"`,
      ].join(','));
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `lead_scores_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const filteredLeads = result?.leads?.filter(l => filterTier === 'all' || l.tier === filterTier) || [];

  if (loadingJobs) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '60vh', gap: 12 }}>
        <Sparkles size={28} style={{ color: 'var(--accent)', animation: 'pulse 2s ease-in-out infinite' }} />
        <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Loading verification jobs...</div>
      </div>
    );
  }

  return (
    <>
      {/* ── Hero Header ── */}
      <div style={{
        background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--bg-sidebar) 100%)',
        borderRadius: 20, border: '1px solid var(--border)', padding: '28px 32px',
        marginBottom: 24, position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -30, right: -30, width: 180, height: 180, borderRadius: '50%', background: 'var(--yellow)', opacity: 0.04 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, var(--yellow) 0%, color-mix(in srgb, var(--yellow) 80%, #000) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Trophy size={18} style={{ color: 'var(--accent-contrast, #fff)' }} />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>AI Lead Scoring</h1>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', maxWidth: 600, lineHeight: 1.6 }}>
          AI-powered quality scoring for verified leads. Configure weights, tiers, and custom instructions — every parameter is controllable.
        </p>
      </div>

      {/* ── Source Selection + Config ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, marginBottom: 20 }}>
        <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', padding: 18 }}>
          <label style={labelStyle}>Source — Verification Job</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <select value={selectedJobId} onChange={e => setSelectedJobId(e.target.value)} style={{ ...inputStyle, appearance: 'none', paddingRight: 28, cursor: 'pointer' }}>
                <option value="">Select a completed job...</option>
                {jobs.map(j => (
                  <option key={j.id} value={j.id}>
                    Job {j.id.slice(0, 8)} — {j.totalProcessed} emails ({j.safe} safe, {j.uncertain} uncertain, {j.risky} risky)
                  </option>
                ))}
              </select>
              <ChevronDown size={12} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-tertiary)' }} />
            </div>
            <button onClick={runScoring} disabled={scoring || !selectedJobId} style={{
              padding: '10px 24px', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, var(--yellow) 0%, color-mix(in srgb, var(--yellow) 80%, #000) 100%)', color: 'var(--accent-contrast, #000)',
              fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6,
              opacity: (scoring || !selectedJobId) ? 0.5 : 1, boxShadow: '0 4px 14px rgba(255,215,0,0.2)',
              transition: 'all 0.15s',
            }}>
              {scoring ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={14} />}
              {scoring ? 'Scoring...' : 'Score Leads'}
            </button>
          </div>
          {selectedJob && (
            <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-tertiary)', display: 'flex', gap: 12 }}>
              <span>📊 {selectedJob.totalProcessed} processed</span>
              <span>✅ {selectedJob.safe} safe</span>
              <span>⚠️ {selectedJob.uncertain} uncertain</span>
              <span>🔴 {selectedJob.risky} risky</span>
            </div>
          )}
        </div>

        {/* Config Toggle */}
        <button onClick={() => setShowConfig(!showConfig)} style={{
          background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)',
          padding: '18px 22px', cursor: 'pointer', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 6, minWidth: 100,
          color: showConfig ? 'var(--accent)' : 'var(--text-secondary)',
          transition: 'all 0.15s',
        }}>
          <Settings size={20} style={{ transition: 'transform 0.3s', transform: showConfig ? 'rotate(90deg)' : '' }} />
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Configure</span>
        </button>
      </div>

      {/* ── Config Panel ── */}
      {showConfig && (
        <div style={{
          background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--accent)',
          padding: 24, marginBottom: 24, animation: 'slideDown 0.2s ease-out',
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Settings size={15} /> Scoring Configuration
          </div>

          {/* Weights */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Weight Multipliers (0-10)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              {Object.entries(config.weights).map(([key, val]) => (
                <div key={key}>
                  <label style={{ fontSize: 10, color: 'var(--text-tertiary)', display: 'block', marginBottom: 3, textTransform: 'capitalize' }}>
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="range" min={0} max={10} step={1} value={val}
                      onChange={e => setConfig(prev => ({ ...prev, weights: { ...prev.weights, [key]: Number(e.target.value) } }))}
                      style={{ flex: 1, accentColor: 'var(--accent)' }} />
                    <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--accent)', minWidth: 20, textAlign: 'center' }}>{val}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tiers */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Tier Thresholds (minimum score)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              {(['platinum', 'gold', 'silver', 'bronze'] as const).map(tier => (
                <div key={tier} style={{
                  borderRadius: 10, padding: '10px 14px', border: `1px solid ${TIER_COLORS[tier]}40`,
                  background: `${TIER_COLORS[tier]}08`,
                }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: TIER_COLORS[tier], textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                    {tier === 'platinum' ? '💎' : tier === 'gold' ? '🥇' : tier === 'silver' ? '🥈' : '🥉'} {tier}
                  </label>
                  <input type="number" min={0} max={100} value={config.tiers[tier]}
                    onChange={e => setConfig(prev => ({ ...prev, tiers: { ...prev.tiers, [tier]: Number(e.target.value) } }))}
                    style={{ ...inputStyle, textAlign: 'center', fontWeight: 800, fontSize: 16, maxWidth: 70 }} />
                </div>
              ))}
            </div>
          </div>

          {/* Options */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={config.b2bMode} onChange={e => setConfig(prev => ({ ...prev, b2bMode: e.target.checked }))}
                style={{ accentColor: 'var(--accent)' }} />
              <span><strong>B2B Mode</strong> — penalize free providers</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={config.includeReasoning} onChange={e => setConfig(prev => ({ ...prev, includeReasoning: e.target.checked }))}
                style={{ accentColor: 'var(--accent)' }} />
              <span><strong>Include Reasoning</strong> — per-lead explanations</span>
            </label>
            <div>
              <label style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600 }}>Batch Size</label>
              <input type="number" min={1} max={200} value={config.batchSize}
                onChange={e => setConfig(prev => ({ ...prev, batchSize: Number(e.target.value) }))}
                style={{ ...inputStyle, maxWidth: 80 }} />
            </div>
          </div>

          {/* Custom Instructions */}
          <div>
            <label style={labelStyle}>Custom Scoring Instructions</label>
            <textarea value={config.customInstructions}
              onChange={e => setConfig(prev => ({ ...prev, customInstructions: e.target.value }))}
              placeholder="e.g. Prioritize .edu and .gov domains. Deprioritize leads from known spam regions. Consider healthcare industry contacts as high value."
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
          </div>
        </div>
      )}

      {/* ── Results ── */}
      {result && (
        <>
          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
            {/* Avg Score */}
            <div style={{
              background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)',
              padding: 18, textAlign: 'center',
            }}>
              <BarChart3 size={18} style={{ color: 'var(--accent)', marginBottom: 6 }} />
              <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--text-primary)' }}>{result.summary.avgScore}</div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Avg Score</div>
            </div>
            {/* Tier Breakdown */}
            {(['platinum', 'gold', 'silver', 'bronze', 'dead'] as const).map(tier => (
              <div key={tier} onClick={() => setFilterTier(filterTier === tier ? 'all' : tier)} style={{
                background: filterTier === tier ? `${TIER_COLORS[tier]}18` : 'var(--bg-card)',
                borderRadius: 14, border: `1px solid ${filterTier === tier ? TIER_COLORS[tier] : 'var(--border)'}`,
                padding: 18, textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s',
              }}>
                <div style={{ fontSize: 13 }}>{tier === 'platinum' ? '💎' : tier === 'gold' ? '🥇' : tier === 'silver' ? '🥈' : tier === 'bronze' ? '🥉' : '💀'}</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: TIER_COLORS[tier] }}>{result.summary.tierBreakdown[tier] || 0}</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>{tier}</div>
              </div>
            ))}
            {/* AI Meta */}
            <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', padding: 18, textAlign: 'center' }}>
              <Zap size={18} style={{ color: 'var(--accent)', marginBottom: 6 }} />
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>{result.ai.latencyMs}ms</div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>{result.ai.provider}</div>
              {result.ai.tokensUsed && <div style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>{result.ai.tokensUsed} tokens</div>}
            </div>
          </div>

          {/* AI Recommendations */}
          {result.summary.recommendations.length > 0 && (
            <div style={{
              background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--accent)',
              padding: 18, marginBottom: 20,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Target size={14} /> AI Recommendations
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {result.summary.recommendations.map((r, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 6, lineHeight: 1.5 }}>
                    <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{i + 1}.</span> {r}
                  </div>
                ))}
              </div>
              {result.summary.topSignals.length > 0 && (
                <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {result.summary.topSignals.map(s => (
                    <span key={s} style={{
                      padding: '3px 8px', borderRadius: 5, fontSize: 9, fontWeight: 600,
                      background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid var(--accent)',
                    }}>{s}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Filter + Export Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
              {filterTier === 'all' ? `All ${result.leads.length} leads` : `${filteredLeads.length} ${filterTier} leads`}
              {filterTier !== 'all' && (
                <button onClick={() => setFilterTier('all')} style={{
                  marginLeft: 8, padding: '2px 8px', borderRadius: 5, fontSize: 9, fontWeight: 600,
                  background: 'var(--bg-app)', border: '1px solid var(--border)', color: 'var(--text-tertiary)', cursor: 'pointer',
                }}>Clear</button>
              )}
            </div>
            <button onClick={exportCSV} style={{
              padding: '6px 14px', borderRadius: 7, border: '1px solid var(--border)',
              background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <Download size={12} /> Export CSV
            </button>
          </div>

          {/* Lead Cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filteredLeads.map((lead, i) => (
              <div key={i} style={{
                background: 'var(--bg-card)', borderRadius: 12, overflow: 'hidden',
                border: `1px solid ${TIER_COLORS[lead.tier]}30`,
                display: 'grid', gridTemplateColumns: '6px 1fr', transition: 'all 0.1s',
              }}>
                {/* Tier color bar */}
                <div style={{ background: TIER_GRADIENTS[lead.tier] }} />
                <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{lead.email}</span>
                      <span style={{
                        padding: '2px 8px', borderRadius: 5, fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                        background: `${TIER_COLORS[lead.tier]}20`, color: TIER_COLORS[lead.tier],
                        border: `1px solid ${TIER_COLORS[lead.tier]}40`,
                      }}>{lead.tier}</span>
                    </div>
                    {lead.reasoning && (
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5, marginBottom: 4 }}>{lead.reasoning}</div>
                    )}
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {lead.signals.map(s => (
                        <span key={s} style={{
                          padding: '1px 6px', borderRadius: 4, fontSize: 8, fontWeight: 600,
                          background: 'var(--bg-app)', color: 'var(--text-tertiary)', border: '1px solid var(--border)',
                        }}>{s}</span>
                      ))}
                    </div>
                    {lead.recommendation && (
                      <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <TrendingUp size={10} style={{ color: 'var(--accent)' }} /> {lead.recommendation}
                      </div>
                    )}
                  </div>
                  {/* Score */}
                  <div style={{
                    width: 56, height: 56, borderRadius: 14, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', background: TIER_GRADIENTS[lead.tier],
                    color: lead.tier === 'gold' ? '#000' : '#fff', flexShrink: 0, marginLeft: 12,
                  }}>
                    <div style={{ fontSize: 20, fontWeight: 900, lineHeight: 1 }}>{lead.score}</div>
                    <div style={{ fontSize: 7, fontWeight: 700, textTransform: 'uppercase', opacity: 0.8 }}>Score</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Empty state */}
      {!result && !scoring && jobs.length === 0 && (
        <div style={{
          textAlign: 'center', padding: '60px 20px', background: 'var(--bg-card)', borderRadius: 20,
          border: '1px dashed var(--border)',
        }}>
          <AlertTriangle size={32} style={{ color: 'var(--text-tertiary)', marginBottom: 12, opacity: 0.4 }} />
          <div style={{ fontSize: 14, color: 'var(--text-tertiary)', fontWeight: 500 }}>No verification jobs found</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', opacity: 0.6, marginTop: 4 }}>
            Run a verification pipeline first, then come back to score the results.
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          padding: '14px 22px', borderRadius: 12, maxWidth: 420,
          background: toast.type === 'error' ? 'var(--red)' : toast.type === 'warning' ? 'var(--yellow)' : 'var(--accent)',
          color: 'var(--accent-contrast, #fff)', fontSize: 12, fontWeight: 600, boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
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
        <AgentCard slug="data_scientist" contextLabel="Lead Scoring Criteria & Methodology" />
      </div>
    </>
  );
}

// ─── Shared Styles ───
const labelStyle: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase',
  letterSpacing: 0.8, display: 'block', marginBottom: 4,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 11px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12,
};
