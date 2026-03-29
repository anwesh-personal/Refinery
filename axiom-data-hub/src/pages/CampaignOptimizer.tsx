import { useState, useEffect } from 'react';
import { apiCall } from '../lib/api';
import {
  Loader2, Settings, Rocket, AlertTriangle, Zap, Clock,
  TrendingUp, Shield, ChevronDown, Calendar
} from 'lucide-react';

interface OptimizerConfig {
  optimizationGoals: Record<string, boolean>;
  constraints: { dailySendLimit: number; warmupRequired: boolean; multiDomainAvailable: boolean; sendingDomainCount: number; timeZone: string };
  campaignContext: { campaignType: string; listSize: number; previousCampaignData: string; industry: string; audienceType: string };
  advancedOptions: Record<string, boolean>;
  customObjectives: string;
}
interface VolumePhase { phase: string; dailyVolume: number; duration: string; description: string }
interface ABTest { variable: string; variationA: string; variationB: string; sampleSize: string; expectedInsight: string }
interface Safeguard { rule: string; reason: string; priority: string }
interface OptimizerResult {
  strategy: { summary: string; overallApproach: string; estimatedPerformance: { deliverabilityRate: string; openRate: string; replyRate: string; bounceRate: string } };
  sendSchedule: { optimalDays: string[]; optimalHours: { hour: string; quality: string }[]; avoidTimes: string[]; timezone: string };
  volumeStrategy: VolumePhase[];
  domainStrategy?: { rotationPattern: string; perDomainLimit: number; warmupSchedule: string; recommendations: string[] };
  abTestRecommendations: ABTest[]; reputationSafeguards: Safeguard[]; warnings: string[];
  ai: { provider: string; model: string; latencyMs: number; wasFallback: boolean; tokensUsed?: number };
}
interface Job { id: string; status: string; totalProcessed: number; safe: number; uncertain: number; results: any[] }

const HOUR_COLORS: Record<string, string> = { peak: '#10a37f', good: '#ffd700', acceptable: '#ff6b35' };
const PRIO_STYLE: Record<string, { bg: string; color: string }> = { critical: { bg: '#ef444418', color: '#ef4444' }, important: { bg: '#ff6b3518', color: '#ff6b35' }, recommended: { bg: '#4285f418', color: '#4285f4' } };
const TIMEZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'];

const DEFAULT_CONFIG: OptimizerConfig = {
  optimizationGoals: { maximizeDeliverability: true, maximizeOpenRate: true, maximizeReplyRate: true, minimizeBounceRate: true, minimizeSpamComplaints: true },
  constraints: { dailySendLimit: 500, warmupRequired: false, multiDomainAvailable: false, sendingDomainCount: 1, timeZone: 'America/New_York' },
  campaignContext: { campaignType: 'cold_outreach', listSize: 0, previousCampaignData: '', industry: '', audienceType: 'B2B' },
  advancedOptions: { analyzeSendWindows: true, volumePacing: true, domainRotation: true, subjectLineOptimization: true, reputationProtection: true },
  customObjectives: '',
};
const CAMPAIGN_TYPES = ['cold_outreach', 'newsletter', 'transactional', 'announcement', 're_engagement', 'drip_sequence'];

export default function CampaignOptimizerPage() {
  const [toast, setToast] = useState<{ type: string; message: string } | null>(null);
  const showToast = (type: string, msg: string) => { setToast({ type, message: msg.slice(0, 200) }); setTimeout(() => setToast(null), 6000); };
  const [config, setConfig] = useState<OptimizerConfig>(DEFAULT_CONFIG);
  const [showConfig, setShowConfig] = useState(true);
  const [optimizing, setOptimizing] = useState(false);
  const [result, setResult] = useState<OptimizerResult | null>(null);
  const [activeTab, setActiveTab] = useState<string>('strategy');
  const [jobs, setJobs] = useState<Job[]>([]); const [selectedJobId, setSelectedJobId] = useState(''); const [loadingJobs, setLoadingJobs] = useState(true);

  useEffect(() => {
    (async () => {
      try { const d = await apiCall<{ jobs: Job[] }>('/api/verify/jobs'); const c = (d.jobs || []).filter(j => j.status === 'completed' && j.results?.length > 0); setJobs(c); if (c.length > 0) setSelectedJobId(c[0].id); }
      catch (e: any) { showToast('error', e.message); } finally { setLoadingJobs(false); }
    })();
  }, []);

  const run = async () => {
    setOptimizing(true); setResult(null);
    try {
      const j = jobs.find(j => j.id === selectedJobId);
      const leads = j ? j.results.map((r: any) => ({ email: r.email, classification: r.classification, riskScore: r.riskScore, checks: r.checks })) : undefined;
      const res = await apiCall<OptimizerResult>('/api/ai/campaign-optimizer', { method: 'POST', body: { leads, config: { ...config, campaignContext: { ...config.campaignContext, listSize: leads?.length || config.campaignContext.listSize } } } });
      setResult(res); setShowConfig(false); showToast('info', `Optimized in ${res.ai.latencyMs}ms`);
    } catch (e: any) { showToast('error', e.message); } finally { setOptimizing(false); }
  };

  if (loadingJobs) return <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '60vh', gap: 12 }}><Rocket size={28} style={{ color: 'var(--accent)', animation: 'pulse 2s ease-in-out infinite' }} /><div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Loading...</div></div>;

  return (
    <>
      {/* Hero */}
      <div style={{ background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--bg-sidebar) 100%)', borderRadius: 20, border: '1px solid var(--border)', padding: '28px 32px', marginBottom: 24, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -30, right: -30, width: 180, height: 180, borderRadius: '50%', background: '#ff6b35', opacity: 0.04 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #ff6b35 0%, #cc5229 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Rocket size={18} style={{ color: '#fff' }} /></div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Campaign Optimizer</h1>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', maxWidth: 600, lineHeight: 1.6 }}>AI-powered send timing, volume pacing, domain rotation, A/B testing, and reputation safeguards.</p>
      </div>

      {/* Config */}
      {showConfig && (
        <div style={{ background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border)', padding: 24, marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 18 }}><Settings size={15} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Campaign Parameters</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 14 }}>
            {/* Source */}
            <div style={{ gridColumn: '1 / -1' }}><label style={labelStyle}>Source (optional)</label>
              <div style={{ position: 'relative' }}>
                <select value={selectedJobId} onChange={e => setSelectedJobId(e.target.value)} style={{ ...inputStyle, appearance: 'none', paddingRight: 28, cursor: 'pointer' }}><option value="">No verification data (general optimization)</option>{jobs.map(j => <option key={j.id} value={j.id}>Job {j.id.slice(0, 8)} — {j.totalProcessed} emails</option>)}</select>
                <ChevronDown size={12} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-tertiary)' }} />
              </div>
            </div>
            <div><label style={labelStyle}>Campaign Type</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{CAMPAIGN_TYPES.map(t => <button key={t} onClick={() => setConfig(p => ({ ...p, campaignContext: { ...p.campaignContext, campaignType: t } }))} style={{ padding: '5px 8px', borderRadius: 6, fontSize: 9, fontWeight: 600, border: `1px solid ${config.campaignContext.campaignType === t ? '#ff6b35' : 'var(--border)'}`, background: config.campaignContext.campaignType === t ? '#ff6b35' : 'transparent', color: config.campaignContext.campaignType === t ? '#fff' : 'var(--text-tertiary)', cursor: 'pointer', textTransform: 'capitalize' }}>{t.replace(/_/g, ' ')}</button>)}</div></div>
            <div><label style={labelStyle}>Daily Send Limit</label><input type="number" min={10} max={50000} value={config.constraints.dailySendLimit} onChange={e => setConfig(p => ({ ...p, constraints: { ...p.constraints, dailySendLimit: Number(e.target.value) } }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>Sending Domains</label><input type="number" min={1} max={20} value={config.constraints.sendingDomainCount} onChange={e => setConfig(p => ({ ...p, constraints: { ...p.constraints, sendingDomainCount: Number(e.target.value), multiDomainAvailable: Number(e.target.value) > 1 } }))} style={{ ...inputStyle, maxWidth: 80 }} /></div>
            <div><label style={labelStyle}>Timezone</label>
              <div style={{ position: 'relative' }}><select value={config.constraints.timeZone} onChange={e => setConfig(p => ({ ...p, constraints: { ...p.constraints, timeZone: e.target.value } }))} style={{ ...inputStyle, appearance: 'none', paddingRight: 28, cursor: 'pointer' }}>{TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}</select><ChevronDown size={12} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-tertiary)' }} /></div></div>
            <div><label style={labelStyle}>Audience</label>
              <div style={{ display: 'flex', gap: 4 }}>{['B2B', 'B2C', 'Mixed'].map(a => <button key={a} onClick={() => setConfig(p => ({ ...p, campaignContext: { ...p.campaignContext, audienceType: a } }))} style={{ flex: 1, padding: '6px', borderRadius: 6, fontSize: 10, fontWeight: 600, border: `1px solid ${config.campaignContext.audienceType === a ? '#ff6b35' : 'var(--border)'}`, background: config.campaignContext.audienceType === a ? '#ff6b35' : 'transparent', color: config.campaignContext.audienceType === a ? '#fff' : 'var(--text-tertiary)', cursor: 'pointer' }}>{a}</button>)}</div></div>
            <div><label style={labelStyle}>Industry</label><input value={config.campaignContext.industry} onChange={e => setConfig(p => ({ ...p, campaignContext: { ...p.campaignContext, industry: e.target.value } }))} placeholder="SaaS, Fintech..." style={inputStyle} /></div>
          </div>
          {/* Toggles */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 11, color: 'var(--text-secondary)' }}><input type="checkbox" checked={config.constraints.warmupRequired} onChange={e => setConfig(p => ({ ...p, constraints: { ...p.constraints, warmupRequired: e.target.checked } }))} style={{ accentColor: '#ff6b35' }} /><strong>New Domain (warmup needed)</strong></label>
            {Object.entries(config.advancedOptions).map(([k, v]) => (
              <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 11, color: 'var(--text-secondary)' }}><input type="checkbox" checked={v} onChange={e => setConfig(p => ({ ...p, advancedOptions: { ...p.advancedOptions, [k]: e.target.checked } }))} style={{ accentColor: '#ff6b35' }} />{k.replace(/([A-Z])/g, ' $1').trim()}</label>
            ))}
          </div>
          <div style={{ marginBottom: 14 }}><label style={labelStyle}>Previous Campaign Data</label><textarea value={config.campaignContext.previousCampaignData} onChange={e => setConfig(p => ({ ...p, campaignContext: { ...p.campaignContext, previousCampaignData: e.target.value } }))} placeholder="Past performance: 25% open rate, 3% reply, 2% bounce..." rows={2} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} /></div>
          <button onClick={run} disabled={optimizing} style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg, #ff6b35 0%, #cc5229 100%)', color: '#fff', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: optimizing ? 0.5 : 1, boxShadow: '0 4px 14px rgba(255,107,53,0.25)' }}>
            {optimizing ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Rocket size={14} />} {optimizing ? 'Optimizing...' : 'Optimize Campaign'}
          </button>
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {!showConfig && <button onClick={() => setShowConfig(true)} style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600, cursor: 'pointer', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 4 }}><Settings size={12} /> Edit Config</button>}

          <div style={{ display: 'flex', gap: 2, marginBottom: 16, background: 'var(--bg-card)', borderRadius: 10, padding: 3, border: '1px solid var(--border)', width: 'fit-content' }}>
            {[{ k: 'strategy', l: 'Strategy' }, { k: 'schedule', l: 'Schedule' }, { k: 'volume', l: 'Volume' }, { k: 'abtests', l: 'A/B Tests' }, { k: 'safeguards', l: 'Safeguards' }].map(t => (
              <button key={t.k} onClick={() => setActiveTab(t.k)} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: activeTab === t.k ? '#ff6b35' : 'transparent', color: activeTab === t.k ? '#fff' : 'var(--text-tertiary)', fontSize: 11, fontWeight: 600 }}>{t.l}</button>
            ))}
          </div>

          {/* Strategy */}
          {activeTab === 'strategy' && result.strategy && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ background: 'linear-gradient(135deg, #ff6b3510 0%, #cc522910 100%)', borderRadius: 16, border: '1px solid #ff6b3530', padding: 22 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>{result.strategy.summary}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{result.strategy.overallApproach}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                {Object.entries(result.strategy.estimatedPerformance).map(([k, v]) => (
                  <div key={k} style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 14, textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text-primary)' }}>{v}</div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>{k.replace(/([A-Z])/g, ' $1')}</div>
                  </div>
                ))}
              </div>
              {result.warnings?.length > 0 && <div style={{ borderRadius: 12, border: '1px solid #ffd70040', background: '#ffd70010', padding: 14 }}>{result.warnings.map((w, i) => <div key={i} style={{ fontSize: 11, color: '#d4a800', display: 'flex', gap: 4, marginBottom: 3 }}><AlertTriangle size={12} style={{ flexShrink: 0 }} /> {w}</div>)}</div>}
            </div>
          )}

          {/* Schedule */}
          {activeTab === 'schedule' && result.sendSchedule && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
              <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', padding: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 5 }}><Calendar size={14} /> Best Days</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{result.sendSchedule.optimalDays.map(d => <span key={d} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: '#10a37f15', color: '#10a37f', border: '1px solid #10a37f30' }}>{d}</span>)}</div>
              </div>
              <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', padding: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 5 }}><Clock size={14} /> Best Hours ({result.sendSchedule.timezone})</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{(result.sendSchedule.optimalHours || []).map(h => <span key={h.hour} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: `${HOUR_COLORS[h.quality] || '#888'}15`, color: HOUR_COLORS[h.quality] || '#888', border: `1px solid ${HOUR_COLORS[h.quality] || '#888'}30` }}>{h.hour} ({h.quality})</span>)}</div>
              </div>
              {result.sendSchedule.avoidTimes?.length > 0 && (
                <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid #ef444425', padding: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#ef4444', marginBottom: 10 }}>🚫 Avoid</div>
                  {result.sendSchedule.avoidTimes.map((t, i) => <div key={i} style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 3 }}>• {t}</div>)}
                </div>
              )}
            </div>
          )}

          {/* Volume */}
          {activeTab === 'volume' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(result.volumeStrategy || []).map((v, i) => (
                <div key={i} style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden', display: 'grid', gridTemplateColumns: '6px 1fr' }}>
                  <div style={{ background: `hsl(${30 + i * 30}, 80%, 55%)` }} />
                  <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div><div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{v.phase}</div><div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.5 }}>{v.description}</div></div>
                    <div style={{ textAlign: 'center', flexShrink: 0, marginLeft: 16 }}><div style={{ fontSize: 22, fontWeight: 900, color: '#ff6b35' }}>{v.dailyVolume}</div><div style={{ fontSize: 8, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>daily</div><div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{v.duration}</div></div>
                  </div>
                </div>
              ))}
              {result.domainStrategy && (
                <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid #8b5cf630', padding: 16, marginTop: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#8b5cf6', marginBottom: 8 }}>🔄 Domain Rotation</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 6 }}><strong>Pattern:</strong> {result.domainStrategy.rotationPattern}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}><strong>Per domain:</strong> {result.domainStrategy.perDomainLimit}/day</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}><strong>Warmup:</strong> {result.domainStrategy.warmupSchedule}</div>
                  {result.domainStrategy.recommendations.map((r, i) => <div key={i} style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 2 }}>• {r}</div>)}
                </div>
              )}
            </div>
          )}

          {/* A/B Tests */}
          {activeTab === 'abtests' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 10 }}>
              {(result.abTestRecommendations || []).map((ab, i) => (
                <div key={i} style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#ff6b35', textTransform: 'uppercase', marginBottom: 6 }}>{ab.variable}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <div style={{ padding: '8px 10px', borderRadius: 8, background: '#10a37f08', border: '1px solid #10a37f25' }}><div style={{ fontSize: 8, fontWeight: 700, color: '#10a37f', marginBottom: 2 }}>VARIATION A</div><div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{ab.variationA}</div></div>
                    <div style={{ padding: '8px 10px', borderRadius: 8, background: '#4285f408', border: '1px solid #4285f425' }}><div style={{ fontSize: 8, fontWeight: 700, color: '#4285f4', marginBottom: 2 }}>VARIATION B</div><div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{ab.variationB}</div></div>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>📊 Sample: {ab.sampleSize}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2, fontStyle: 'italic' }}><TrendingUp size={10} style={{ verticalAlign: 'middle' }} /> {ab.expectedInsight}</div>
                </div>
              ))}
            </div>
          )}

          {/* Safeguards */}
          {activeTab === 'safeguards' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(result.reputationSafeguards || []).map((s, i) => {
                const ps = PRIO_STYLE[s.priority] || PRIO_STYLE.recommended;
                return (
                  <div key={i} style={{ background: 'var(--bg-card)', borderRadius: 12, padding: '14px 18px', border: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center' }}>
                    <div><div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}><Shield size={13} /> {s.rule}</div><div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{s.reason}</div></div>
                    <span style={{ padding: '3px 8px', borderRadius: 5, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', background: ps.bg, color: ps.color }}>{s.priority}</span>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, marginTop: 16, fontSize: 10, color: 'var(--text-tertiary)' }}>
            <span><Zap size={10} style={{ verticalAlign: 'middle' }} /> {result.ai.latencyMs}ms</span><span>🤖 {result.ai.provider} → {result.ai.model}</span>
            {result.ai.tokensUsed && <span>📊 {result.ai.tokensUsed} tokens</span>}
          </div>
        </>
      )}

      {toast && <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, padding: '14px 22px', borderRadius: 12, maxWidth: 420, background: toast.type === 'error' ? 'var(--red)' : 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 600, boxShadow: '0 10px 30px rgba(0,0,0,0.3)', animation: 'slideUp 0.25s ease-out', cursor: 'pointer' }} onClick={() => setToast(null)}>{toast.type === 'error' ? '❌' : 'ℹ️'} {toast.message}</div>}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}@keyframes slideUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </>
  );
}
const labelStyle: React.CSSProperties = { fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.8, display: 'block', marginBottom: 4 };
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12 };
