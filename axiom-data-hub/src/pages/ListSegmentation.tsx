import { useState, useEffect } from 'react';
import { apiCall } from '../lib/api';
import {
  Loader2, ChevronDown, Settings, Layers, AlertTriangle,
  Zap, Mail, Clock, TrendingUp, Download, Users
} from 'lucide-react';
import AgentCard from '../components/AgentCard';

// ─── Types ───
interface SegmentationConfig {
  targetSegments: number; criteria: Record<string, boolean>;
  generateCampaignStrategy: boolean; generateSubjectLines: boolean;
  productDescription: string; campaignGoal: string; customCriteria: string;
  includeClassifications: string[]; maxLeads: number;
}
interface CampaignStrategy {
  approach: string; tone: string; keyMessages: string[];
  subjectLines?: string[]; callToAction: string; bestSendTime: string;
}
interface SegmentGroup {
  name: string; description: string; priority: 'high' | 'medium' | 'low';
  leadCount: number; emails: string[]; characteristics: string[];
  campaignStrategy?: CampaignStrategy; estimatedResponseRate: string;
}
interface SegmentationResult {
  segments: SegmentGroup[];
  overallStrategy: { summary: string; sequenceRecommendation: string; estimatedTotalReach: number; warnings: string[] };
  ai: { provider: string; model: string; latencyMs: number; wasFallback: boolean; tokensUsed?: number };
}
interface Job { id: string; status: string; totalProcessed: number; safe: number; uncertain: number; risky: number; results: any[] }

const PRIORITY_COLORS: Record<string, { border: string; bg: string; text: string; gradient: string }> = {
  high: { border: 'var(--green)', bg: '#10a37f12', text: 'var(--green)', gradient: 'linear-gradient(135deg, var(--green) 0%, color-mix(in srgb, var(--green) 70%, #000) 100%)' },
  medium: { border: 'var(--yellow)', bg: '#ffd70012', text: 'var(--yellow)', gradient: 'linear-gradient(135deg, var(--yellow) 0%, #ccad00 100%)' },
  low: { border: '#a0a0a0', bg: '#a0a0a012', text: '#888', gradient: 'linear-gradient(135deg, #999 0%, #666 100%)' },
};

const DEFAULT_CONFIG: SegmentationConfig = {
  targetSegments: 4,
  criteria: { roleHierarchy: true, companySize: true, industryVertical: true, engagementReadiness: true, riskProfile: true, geographicRegion: false },
  generateCampaignStrategy: true, generateSubjectLines: true,
  productDescription: '', campaignGoal: '', customCriteria: '',
  includeClassifications: ['safe', 'uncertain'], maxLeads: 200,
};

export default function ListSegmentationPage() {
  const [toast, setToast] = useState<{ type: 'error' | 'warning' | 'info'; message: string } | null>(null);
  const showToast = (type: 'error' | 'warning' | 'info', message: string) => {
    setToast({ type, message: message.replace(/<[^>]*>/g, '').trim().slice(0, 200) });
    setTimeout(() => setToast(null), 6000);
  };

  const [config, setConfig] = useState<SegmentationConfig>(DEFAULT_CONFIG);
  const [showConfig, setShowConfig] = useState(false);
  const [segmenting, setSegmenting] = useState(false);
  const [result, setResult] = useState<SegmentationResult | null>(null);
  const [expandedSegment, setExpandedSegment] = useState<number | null>(null);

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

  const runSegmentation = async () => {
    if (!selectedJob) return showToast('warning', 'No job selected');
    setSegmenting(true); setResult(null);
    try {
      const leads = selectedJob.results.map((r: any) => ({ email: r.email, classification: r.classification, riskScore: r.riskScore, checks: r.checks }));
      const res = await apiCall<SegmentationResult>('/api/ai/list-segmentation', { method: 'POST', body: { leads, config } });
      setResult(res);
      showToast('info', `Created ${res.segments?.length || 0} segments in ${res.ai.latencyMs}ms`);
    } catch (e: any) { showToast('error', e.message); }
    finally { setSegmenting(false); }
  };

  const exportSegment = (seg: SegmentGroup) => {
    const rows = ['Email', ...seg.emails].join('\n');
    const blob = new Blob([rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `segment_${seg.name.replace(/\s+/g, '_').toLowerCase()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (loadingJobs) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '60vh', gap: 12 }}>
        <Layers size={28} style={{ color: 'var(--accent)', animation: 'pulse 2s ease-in-out infinite' }} />
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
        <div style={{ position: 'absolute', top: -30, right: -30, width: 180, height: 180, borderRadius: '50%', background: 'var(--purple)', opacity: 0.04 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, var(--purple) 0%, color-mix(in srgb, var(--purple) 70%, #000) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Layers size={18} style={{ color: 'var(--accent-contrast, #fff)' }} />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>List Segmentation</h1>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', maxWidth: 600, lineHeight: 1.6 }}>
          AI-powered lead segmentation with per-segment campaign strategy, subject lines, and send-time recommendations.
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
            <button onClick={runSegmentation} disabled={segmenting || !selectedJobId} style={{
              padding: '10px 24px', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, var(--purple) 0%, color-mix(in srgb, var(--purple) 70%, #000) 100%)', color: 'var(--accent-contrast, #fff)',
              fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6,
              opacity: (segmenting || !selectedJobId) ? 0.5 : 1, boxShadow: '0 4px 14px rgba(139,92,246,0.25)',
            }}>
              {segmenting ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Layers size={14} />}
              {segmenting ? 'Segmenting...' : 'Segment Leads'}
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
            <Settings size={15} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Segmentation Configuration
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <div>
              <label style={labelStyle}>Target Segments</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="range" min={2} max={10} value={config.targetSegments}
                  onChange={e => setConfig(prev => ({ ...prev, targetSegments: Number(e.target.value) }))}
                  style={{ flex: 1, accentColor: 'var(--purple)' }} />
                <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--purple)', minWidth: 24, textAlign: 'center' }}>{config.targetSegments}</span>
              </div>
            </div>
            <div>
              <label style={labelStyle}>Product / Service</label>
              <input value={config.productDescription} onChange={e => setConfig(prev => ({ ...prev, productDescription: e.target.value }))} placeholder="What are you selling?" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Campaign Goal</label>
              <input value={config.campaignGoal} onChange={e => setConfig(prev => ({ ...prev, campaignGoal: e.target.value }))} placeholder="e.g. Book demos, Drive signups" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Max Leads</label>
              <input type="number" min={10} max={500} value={config.maxLeads} onChange={e => setConfig(prev => ({ ...prev, maxLeads: Number(e.target.value) }))} style={{ ...inputStyle, maxWidth: 100 }} />
            </div>
          </div>

          {/* Criteria toggles */}
          <div style={{ marginTop: 16 }}>
            <div style={{ ...labelStyle, marginBottom: 8 }}>Segmentation Criteria</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 6 }}>
              {Object.entries(config.criteria).map(([key, val]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, color: 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={val} onChange={e => setConfig(prev => ({ ...prev, criteria: { ...prev.criteria, [key]: e.target.checked } }))} style={{ accentColor: 'var(--purple)' }} />
                  {key.replace(/([A-Z])/g, ' $1').trim()}
                </label>
              ))}
            </div>
          </div>

          {/* Strategy toggles */}
          <div style={{ display: 'flex', gap: 16, marginTop: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={config.generateCampaignStrategy} onChange={e => setConfig(prev => ({ ...prev, generateCampaignStrategy: e.target.checked }))} style={{ accentColor: 'var(--purple)' }} />
              <strong>Generate Campaign Strategy</strong>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={config.generateSubjectLines} onChange={e => setConfig(prev => ({ ...prev, generateSubjectLines: e.target.checked }))} style={{ accentColor: 'var(--purple)' }} />
              <strong>Generate Subject Lines</strong>
            </label>
          </div>

          {/* Classifications */}
          <div style={{ marginTop: 14 }}>
            <div style={{ ...labelStyle, marginBottom: 6 }}>Include</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {['safe', 'uncertain', 'risky', 'reject'].map(c => (
                <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={config.includeClassifications.includes(c)}
                    onChange={e => setConfig(prev => ({
                      ...prev, includeClassifications: e.target.checked ? [...prev.includeClassifications, c] : prev.includeClassifications.filter(x => x !== c)
                    }))} style={{ accentColor: 'var(--purple)' }} />
                  {c}
                </label>
              ))}
            </div>
          </div>

          {/* Custom */}
          <div style={{ marginTop: 14 }}>
            <label style={labelStyle}>Custom Criteria</label>
            <textarea value={config.customCriteria} onChange={e => setConfig(prev => ({ ...prev, customCriteria: e.target.value }))}
              placeholder="Additional segmentation instructions..." rows={2}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
          </div>
        </div>
      )}

      {/* ── Results ── */}
      {result && (
        <>
          {/* Overall Strategy */}
          {result.overallStrategy && (
            <div style={{
              background: 'linear-gradient(135deg, color-mix(in srgb, var(--purple) 6%, transparent) 0%, color-mix(in srgb, var(--purple) 6%, transparent) 100%)',
              borderRadius: 16, border: '1px solid var(--purple)', padding: 22, marginBottom: 20,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--purple)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
                📋 Overall Strategy
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.7, fontWeight: 500, marginBottom: 10 }}>
                {result.overallStrategy.summary}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 8 }}>
                <strong>Sequence:</strong> {result.overallStrategy.sequenceRecommendation}
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 10, color: 'var(--text-tertiary)' }}>
                <span><Users size={10} style={{ verticalAlign: 'middle' }} /> {result.overallStrategy.estimatedTotalReach} total reach</span>
                <span><Zap size={10} style={{ verticalAlign: 'middle' }} /> {result.ai.latencyMs}ms</span>
                <span>🤖 {result.ai.provider} → {result.ai.model}</span>
                {result.ai.tokensUsed && <span>📊 {result.ai.tokensUsed} tokens</span>}
              </div>
              {result.overallStrategy.warnings.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  {result.overallStrategy.warnings.map((w, i) => (
                    <div key={i} style={{ fontSize: 10, color: 'var(--yellow)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                      <AlertTriangle size={10} /> {w}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Segment Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 14 }}>
            {(result.segments || []).map((seg, i) => {
              const pc = PRIORITY_COLORS[seg.priority] || PRIORITY_COLORS.medium;
              const isExpanded = expandedSegment === i;
              return (
                <div key={i} style={{
                  borderRadius: 16, overflow: 'hidden', background: 'var(--bg-card)',
                  border: `1px solid ${pc.border}40`, transition: 'transform 0.15s, box-shadow 0.15s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 8px 25px ${pc.border}15`; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
                >
                  {/* Gradient Header */}
                  <div style={{ background: pc.gradient, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent-contrast, #fff)' }}>{seg.name}</div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>
                        {seg.leadCount} leads · {seg.estimatedResponseRate} est. response
                      </div>
                    </div>
                    <div style={{
                      padding: '4px 10px', borderRadius: 6, fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                      background: 'rgba(255,255,255,0.2)', color: 'var(--accent-contrast, #fff)',
                    }}>{seg.priority}</div>
                  </div>

                  <div style={{ padding: '14px 18px' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 10 }}>{seg.description}</div>

                    {/* Characteristics */}
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
                      {seg.characteristics.map(c => (
                        <span key={c} style={{ padding: '2px 7px', borderRadius: 4, fontSize: 9, fontWeight: 600, background: pc.bg, color: pc.text, border: `1px solid ${pc.border}30` }}>{c}</span>
                      ))}
                    </div>

                    {/* Expand/Collapse */}
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => setExpandedSegment(isExpanded ? null : i)} style={{
                        flex: 1, padding: '6px 0', borderRadius: 7, border: '1px solid var(--border)',
                        background: 'var(--bg-app)', color: 'var(--text-secondary)', fontSize: 10,
                        fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                      }}>
                        <ChevronDown size={10} style={{ transform: isExpanded ? 'rotate(180deg)' : '', transition: 'transform 0.2s' }} />
                        {isExpanded ? 'Collapse' : 'View Details & Strategy'}
                      </button>
                      <button onClick={() => exportSegment(seg)} style={{
                        padding: '6px 10px', borderRadius: 7, border: '1px solid var(--border)',
                        background: 'var(--bg-app)', color: 'var(--text-secondary)', fontSize: 10,
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3,
                      }}>
                        <Download size={10} /> CSV
                      </button>
                    </div>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <div style={{ marginTop: 12, animation: 'slideDown 0.2s ease-out' }}>
                        {/* Email List */}
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ ...labelStyle, marginBottom: 4 }}><Mail size={9} style={{ verticalAlign: 'middle' }} /> Emails ({seg.emails.length})</div>
                          <div style={{
                            maxHeight: 120, overflowY: 'auto', padding: '8px 10px', borderRadius: 8,
                            background: 'var(--bg-app)', border: '1px solid var(--border)',
                            fontSize: 10, fontFamily: 'monospace', color: 'var(--text-secondary)', lineHeight: 1.6,
                          }}>
                            {seg.emails.join('\n')}
                          </div>
                        </div>

                        {/* Campaign Strategy */}
                        {seg.campaignStrategy && (
                          <div style={{ borderRadius: 10, border: `1px solid ${pc.border}25`, padding: 14, background: `${pc.border}05` }}>
                            <div style={{ ...labelStyle, marginBottom: 8, color: pc.text }}>📧 Campaign Strategy</div>
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 8 }}>
                              <strong>Approach:</strong> {seg.campaignStrategy.approach}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
                              <strong>Tone:</strong> <span style={{ padding: '1px 6px', borderRadius: 4, background: pc.bg, color: pc.text, fontSize: 10, fontWeight: 600 }}>{seg.campaignStrategy.tone}</span>
                            </div>
                            {/* Key Messages */}
                            <div style={{ marginBottom: 8 }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 3 }}>Key Messages</div>
                              {seg.campaignStrategy.keyMessages.map((m, j) => (
                                <div key={j} style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', gap: 5, marginBottom: 2 }}>
                                  <span style={{ color: pc.text, fontWeight: 700 }}>•</span> {m}
                                </div>
                              ))}
                            </div>
                            {/* Subject Lines */}
                            {seg.campaignStrategy.subjectLines && seg.campaignStrategy.subjectLines.length > 0 && (
                              <div style={{ marginBottom: 8 }}>
                                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 3 }}>Subject Lines</div>
                                {seg.campaignStrategy.subjectLines.map((s, j) => (
                                  <div key={j} style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 500, padding: '4px 8px', borderRadius: 5, background: 'var(--bg-app)', border: '1px solid var(--border)', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <Mail size={9} style={{ color: pc.text }} /> {s}
                                  </div>
                                ))}
                              </div>
                            )}
                            <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--text-tertiary)' }}>
                              <span><TrendingUp size={9} style={{ verticalAlign: 'middle' }} /> CTA: {seg.campaignStrategy.callToAction}</span>
                              <span><Clock size={9} style={{ verticalAlign: 'middle' }} /> Best: {seg.campaignStrategy.bestSendTime}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {!result && !segmenting && jobs.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: 'var(--bg-card)', borderRadius: 20, border: '1px dashed var(--border)' }}>
          <AlertTriangle size={32} style={{ color: 'var(--text-tertiary)', marginBottom: 12, opacity: 0.4 }} />
          <div style={{ fontSize: 14, color: 'var(--text-tertiary)', fontWeight: 500 }}>No verification jobs found</div>
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999, padding: '14px 22px', borderRadius: 12, maxWidth: 420,
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
        <AgentCard slug="data_scientist" contextLabel="List Segmentation Strategy" />
      </div>
    </>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.8, display: 'block', marginBottom: 4,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12,
};
