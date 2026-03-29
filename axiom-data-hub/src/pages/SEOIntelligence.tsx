import { useState, useCallback } from 'react';
import { apiCall } from '../lib/api';
import {
  Loader2, Search, Globe, BarChart3, GitCompare, Database,
  Copy, Check, AlertTriangle, Layers, Target
} from 'lucide-react';
import AgentCard from '../components/AgentCard';

// ── Types ──
interface CrossRefResult {
  domain: string; lead_count: number; verified_safe: number;
  verified_risky: number; unique_companies: number; sample_titles: string[];
}

// ── Mock Data (preview mode until SEMrush connected) ──
const MOCK_KEYWORD = {
  keyword: 'email verification', volume: 14800, difficulty: 67, cpc: 4.20, competition: 0.82,
  intent: 'Commercial' as const, trend: [8200, 9100, 10400, 11200, 12800, 13500, 14100, 14800, 13900, 14200, 14600, 14800],
  serpFeatures: ['People Also Ask', 'Featured Snippet', 'Sitelinks', 'Reviews'],
  related: [
    { kw: 'email verification tool', vol: 6600, kd: 58, cpc: 5.10, intent: 'Commercial', trend: 12 },
    { kw: 'verify email address', vol: 5400, kd: 45, cpc: 3.80, intent: 'Transactional', trend: 8 },
    { kw: 'bulk email verifier', vol: 3200, kd: 52, cpc: 6.40, intent: 'Commercial', trend: 15 },
    { kw: 'email validation api', vol: 2900, kd: 61, cpc: 7.20, intent: 'Transactional', trend: 22 },
    { kw: 'free email checker', vol: 9100, kd: 38, cpc: 1.50, intent: 'Informational', trend: -5 },
    { kw: 'email list cleaning', vol: 2100, kd: 44, cpc: 4.90, intent: 'Commercial', trend: 18 },
    { kw: 'email deliverability', vol: 4800, kd: 55, cpc: 3.60, intent: 'Informational', trend: 10 },
    { kw: 'smtp verification', vol: 1600, kd: 72, cpc: 8.10, intent: 'Transactional', trend: 6 },
  ],
};

const MOCK_DOMAIN = {
  domain: 'zerobounce.net', authority: 62, organicTraffic: 89400, paidTraffic: 12300,
  organicKeywords: 18200, backlinks: 342000, referringDomains: 4800,
  trafficTrend: [62000, 65000, 71000, 74000, 78000, 82000, 85000, 87000, 88000, 89400],
  topKeywords: [
    { kw: 'email verification', pos: 3, vol: 14800, traffic: 4200 },
    { kw: 'email verifier', pos: 2, vol: 8100, traffic: 3100 },
    { kw: 'verify email', pos: 5, vol: 6200, traffic: 1800 },
    { kw: 'email checker', pos: 4, vol: 5400, traffic: 1500 },
    { kw: 'bulk email verification', pos: 1, vol: 3200, traffic: 1400 },
  ],
  competitors: [
    { domain: 'neverbounce.com', commonKw: 2400, authority: 55 },
    { domain: 'hunter.io', commonKw: 1800, authority: 71 },
    { domain: 'emaillistverify.com', commonKw: 1200, authority: 48 },
    { domain: 'debounce.io', commonKw: 980, authority: 42 },
  ],
};

const MOCK_SERP = [
  { pos: 1, domain: 'zerobounce.net', url: '/email-verification', title: 'Email Verification - 99% Accuracy | ZeroBounce', authority: 62, traffic: 4200 },
  { pos: 2, domain: 'neverbounce.com', url: '/', title: 'Email Verification & List Cleaning | NeverBounce', authority: 55, traffic: 3100 },
  { pos: 3, domain: 'hunter.io', url: '/email-verifier', title: 'Free Email Verifier - Hunter', authority: 71, traffic: 2800 },
  { pos: 4, domain: 'emaillistverify.com', url: '/', title: 'Email List Verify - Bulk Email Validation', authority: 48, traffic: 1900 },
  { pos: 5, domain: 'debounce.io', url: '/', title: 'DeBounce - Email Validation & Verification', authority: 42, traffic: 1500 },
  { pos: 6, domain: 'bounceless.io', url: '/', title: 'Bounceless - Email Verification Service', authority: 35, traffic: 1100 },
  { pos: 7, domain: 'clearout.io', url: '/', title: 'Clearout - Email Verification Platform', authority: 40, traffic: 900 },
  { pos: 8, domain: 'mailfloss.com', url: '/', title: 'Mailfloss - Automated Email List Cleaning', authority: 32, traffic: 750 },
];

const MOCK_GAP = {
  domain: 'iiinfrastructure.com', competitor: 'zerobounce.net',
  shared: 340, yourUnique: 120, theirUnique: 17800,
  gaps: [
    { kw: 'email verification api', vol: 2900, theirPos: 4, yourPos: null as number | null },
    { kw: 'bulk email verifier', vol: 3200, theirPos: 1, yourPos: null as number | null },
    { kw: 'email list cleaning service', vol: 1800, theirPos: 3, yourPos: null as number | null },
    { kw: 'email validation tool', vol: 2400, theirPos: 5, yourPos: 42 },
    { kw: 'verify email address free', vol: 5100, theirPos: 6, yourPos: null as number | null },
    { kw: 'email bounce checker', vol: 1200, theirPos: 2, yourPos: null as number | null },
  ],
};

const INTENT_COLORS: Record<string, string> = {
  Commercial: 'var(--red)', Transactional: 'var(--purple)', Informational: 'var(--blue)', Navigational: 'var(--green)',
};

// ── Tool Tabs ──
type ToolTab = 'keyword' | 'domain' | 'ranking' | 'crossref' | 'competitor';
const TOOL_TABS: { key: ToolTab; label: string; icon: any; desc: string; color: string }[] = [
  { key: 'keyword', label: 'Keyword Research', icon: Search, desc: 'Volume, difficulty, CPC, intent, SERP features', color: 'var(--red)' },
  { key: 'domain', label: 'Domain Analytics', icon: Globe, desc: 'Authority, traffic, top keywords, competitors', color: 'var(--purple)' },
  { key: 'ranking', label: 'SERP Analysis', icon: BarChart3, desc: 'Top ranking pages for any keyword', color: 'var(--blue)' },
  { key: 'crossref', label: 'Cross-Reference', icon: Database, desc: 'Check domains against our ClickHouse data', color: 'var(--green)' },
  { key: 'competitor', label: 'Keyword Gap', icon: GitCompare, desc: 'Find keywords competitors rank for that you don\'t', color: 'var(--yellow)' },
];

export default function SEOIntelligencePage() {
  const [activeTab, setActiveTab] = useState<ToolTab>('keyword');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ type: string; message: string } | null>(null);
  const showToast = (type: string, msg: string) => { setToast({ type, message: msg.slice(0, 200) }); setTimeout(() => setToast(null), 6000); };
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string, id: string) => { navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(null), 2000); };

  // ── Tool status ──
  const [kwInput, setKwInput] = useState('');
  const [kwStatus, setKwStatus] = useState<string | null>(null);
  const [domInput, setDomInput] = useState('');
  const [domStatus, setDomStatus] = useState<string | null>(null);
  const [rankKw, setRankKw] = useState('');
  const [rankStatus, setRankStatus] = useState<string | null>(null);
  const [crInput, setCrInput] = useState('');
  const [crResults, setCrResults] = useState<{ matches: CrossRefResult[]; missing_domains: string[]; found_in_database: number; not_found: number } | null>(null);
  const [compDomain, setCompDomain] = useState('');
  const [compTarget, setCompTarget] = useState('');
  const [compStatus, setCompStatus] = useState<string | null>(null);



  // ── Pipeline Workflow ──
  const [pipelineKeyword, setPipelineKeyword] = useState('');
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineStep, setPipelineStep] = useState(0);
  const [pipelineLog, setPipelineLog] = useState<string[]>([]);

  // ── Execute Tool ──
  const execute = useCallback(async (tool: string, params: any) => {
    setLoading(true);
    try {
      // Use agent conversation for tool execution
      const res = await apiCall<any>(`/api/ai/${tool}`, { method: 'POST', body: params });
      return res;
    } catch (e: any) {
      showToast('error', e.message);
      return null;
    } finally { setLoading(false); }
  }, []);

  // ── Cross-Reference (direct ClickHouse query via backend) ──
  const runCrossRef = async () => {
    const domains = crInput.split(/[\n,;]+/).map(d => d.trim().toLowerCase()).filter(Boolean);
    if (!domains.length) return showToast('warning', 'Enter at least one domain');
    setLoading(true);
    try {
      const res = await apiCall<any>('/api/ai/seo/cross-reference', { method: 'POST', body: { domains } });
      setCrResults(res);
      showToast('info', `Found ${res.found_in_database || 0} of ${domains.length} domains in our database`);
    } catch (e: any) {
      showToast('error', e.message);
    } finally { setLoading(false); }
  };

  // ── Tommy's Pipeline ──
  const runPipeline = async () => {
    if (!pipelineKeyword.trim()) return showToast('warning', 'Enter a seed keyword');
    setPipelineRunning(true); setPipelineStep(1); setPipelineLog(['🔍 Step 1: Researching seed keyword...']);

    try {
      // Step 1: Keyword research
      const kwRes = await apiCall<any>('/api/ai/seo/keywords', { method: 'POST', body: { keyword: pipelineKeyword } });
      const isConfigured = kwRes?.status !== 'semrush_not_configured';

      if (!isConfigured) {
        setPipelineLog(prev => [
          ...prev,
          '⚠️ SEMrush API not configured yet.',
          '📋 Using manual mode — enter domains to cross-reference below.',
          `💡 Once SEMrush is connected, this pipeline will automatically:`,
          `   1. Find sub-keywords for "${pipelineKeyword}"`,
          `   2. Get ranking domains for each`,
          `   3. Cross-reference all domains against our ClickHouse data`,
          `   4. Report which domains we already track`,
        ]);
        setPipelineStep(0);
        setPipelineRunning(false);
        return;
      }

      // Steps 2-4 would execute when SEMrush is live
      setPipelineLog(prev => [...prev, `✅ Found ${kwRes.related?.length || 0} related keywords`]);
      setPipelineStep(2);
      setPipelineLog(prev => [...prev, '🌐 Step 2: Finding ranking domains...']);

      // ... SEMrush flow continues
    } catch (e: any) {
      setPipelineLog(prev => [...prev, `❌ Error: ${e.message}`]);
    } finally { setPipelineRunning(false); }
  };

  const tabColor = TOOL_TABS.find(t => t.key === activeTab)?.color || 'var(--red)';

  return (
    <>
      {/* Hero */}
      <div style={{ background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--bg-sidebar) 100%)', borderRadius: 20, border: '1px solid var(--border)', padding: '28px 32px', marginBottom: 24, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -30, right: -30, width: 180, height: 180, borderRadius: '50%', background: 'var(--red)', opacity: 0.04 }} />
        <div style={{ position: 'absolute', bottom: -40, left: '50%', width: 200, height: 200, borderRadius: '50%', background: 'var(--purple)', opacity: 0.03 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, var(--red) 0%, var(--purple) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Search size={18} style={{ color: 'var(--accent-contrast)' }} /></div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>SEO Intelligence</h1>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', maxWidth: 700, lineHeight: 1.6 }}>
          Keyword research, domain analytics, competitive intelligence, and cross-referencing against your data.
          Powered by SEMrush + Oracle agent. <strong>Tommy's workflow:</strong> keyword → sub-keywords → ranking domains → cross-reference → track.
        </p>
      </div>

      {/* ═══ Tommy's Keyword Pipeline ═══ */}
      <div style={{ background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border)', padding: 20, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, var(--red) 0%, var(--red) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Layers size={14} style={{ color: 'var(--accent-contrast)' }} /></div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>Keyword → Domain Pipeline</div>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Tommy's workflow: seed keyword → sub-keywords → ranking domains → cross-reference with our data</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: pipelineLog.length ? 12 : 0 }}>
          <input
            value={pipelineKeyword} onChange={e => setPipelineKeyword(e.target.value)}
            placeholder="Enter seed keyword (e.g., 'email verification SaaS')"
            onKeyDown={e => e.key === 'Enter' && runPipeline()}
            style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13 }}
          />
          <button onClick={runPipeline} disabled={pipelineRunning} style={{
            padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg, var(--red) 0%, var(--purple) 100%)', color: 'var(--accent-contrast)',
            fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5,
            opacity: pipelineRunning ? 0.5 : 1, whiteSpace: 'nowrap',
          }}>
            {pipelineRunning ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Target size={14} />}
            Run Pipeline
          </button>
        </div>

        {/* Pipeline Steps */}
        {pipelineStep > 0 && (
          <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
            {['Research', 'Domains', 'Cross-Ref', 'Report'].map((s, i) => (
              <div key={s} style={{
                flex: 1, padding: '6px 0', borderRadius: 6, textAlign: 'center',
                background: i + 1 <= pipelineStep ? 'linear-gradient(135deg, var(--red) 0%, var(--purple) 100%)' : 'var(--bg-app)',
                color: i + 1 <= pipelineStep ? 'var(--accent-contrast)' : 'var(--text-tertiary)',
                fontSize: 9, fontWeight: 700, transition: 'all 0.3s',
              }}>{i + 1}. {s}</div>
            ))}
          </div>
        )}

        {/* Pipeline Log */}
        {pipelineLog.length > 0 && (
          <div style={{ background: 'var(--bg-app)', borderRadius: 10, border: '1px solid var(--border)', padding: 12, maxHeight: 200, overflowY: 'auto' }}>
            {pipelineLog.map((l, i) => (
              <div key={i} style={{ fontSize: 11, color: l.startsWith('❌') ? 'var(--red)' : l.startsWith('⚠️') ? 'var(--yellow)' : l.startsWith('✅') ? 'var(--green)' : 'var(--text-secondary)', lineHeight: 1.8, fontFamily: 'monospace' }}>{l}</div>
            ))}
          </div>
        )}
      </div>

      {/* ═══ Tool Tabs ═══ */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 2 }}>
        {TOOL_TABS.map(t => {
          const Icon = t.icon;
          const active = activeTab === t.key;
          return (
            <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
              padding: '10px 16px', borderRadius: 12, border: active ? `1px solid ${t.color}40` : '1px solid var(--border)', cursor: 'pointer',
              background: active ? `color-mix(in srgb, ${t.color} 10%, var(--bg-card))` : 'var(--bg-card)',
              color: active ? t.color : 'var(--text-tertiary)',
              fontSize: 11, fontWeight: active ? 700 : 600, display: 'flex', alignItems: 'center', gap: 6,
              transition: 'all 0.15s ease', whiteSpace: 'nowrap', flexShrink: 0,
            }}>
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* ═══ KEYWORD RESEARCH ═══ */}
      {activeTab === 'keyword' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input value={kwInput} onChange={e => setKwInput(e.target.value)} placeholder="Enter keyword (e.g., 'email verification')"
              onKeyDown={e => e.key === 'Enter' && !loading && kwInput.trim() && execute('seo/keywords', { keyword: kwInput }).then(r => { if (r) setKwStatus(r.status || null); })}
              style={{ flex: 1, padding: '12px 16px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13 }} />
            <button onClick={() => execute('seo/keywords', { keyword: kwInput }).then(r => { if (r) setKwStatus(r.status || null); })} disabled={loading || !kwInput.trim()} style={{
              padding: '12px 20px', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: `linear-gradient(135deg, ${tabColor} 0%, color-mix(in srgb, ${tabColor} 70%, #000) 100%)`,
              color: 'var(--accent-contrast)', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, opacity: loading ? 0.5 : 1,
            }}>{loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={14} />} Research</button>
          </div>

          {kwStatus === 'semrush_not_configured' && (
            <div style={{ background: 'color-mix(in srgb, var(--yellow) 8%, var(--bg-card))', borderRadius: 14, border: '1px solid color-mix(in srgb, var(--yellow) 30%, var(--border))', padding: 16, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={14} style={{ color: 'var(--yellow)', flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>SEMrush API not configured. Showing <strong>preview data</strong> below. Add API key in <strong>AI Settings → Integrations</strong>.</span>
            </div>
          )}

          {/* ── Keyword Overview Cards ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Volume', value: MOCK_KEYWORD.volume.toLocaleString(), sub: '/mo', color: 'var(--red)' },
              { label: 'Keyword Difficulty', value: `${MOCK_KEYWORD.difficulty}%`, sub: 'Hard', color: MOCK_KEYWORD.difficulty > 60 ? 'var(--red)' : MOCK_KEYWORD.difficulty > 30 ? 'var(--yellow)' : 'var(--green)' },
              { label: 'CPC', value: `$${MOCK_KEYWORD.cpc.toFixed(2)}`, sub: 'avg', color: 'var(--purple)' },
              { label: 'Competition', value: MOCK_KEYWORD.competition.toFixed(2), sub: 'High', color: 'var(--yellow)' },
              { label: 'Intent', value: MOCK_KEYWORD.intent, sub: '', color: INTENT_COLORS[MOCK_KEYWORD.intent] || 'var(--text-tertiary)' },
            ].map((c, i) => (
              <div key={i} style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', padding: 16, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: 3, background: c.color }} />
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>{c.label}</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: c.color }}>{c.value}</div>
                {c.sub && <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>{c.sub}</div>}
              </div>
            ))}
          </div>

          {/* ── Trend Sparkline ── */}
          <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 10 }}>12-Month Volume Trend</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 60 }}>
              {MOCK_KEYWORD.trend.map((v, i) => {
                const max = Math.max(...MOCK_KEYWORD.trend);
                const h = (v / max) * 100;
                return <div key={i} style={{ flex: 1, height: `${h}%`, borderRadius: '4px 4px 0 0', background: `linear-gradient(180deg, var(--red) 0%, color-mix(in srgb, var(--red) 40%, transparent) 100%)`, transition: 'height 0.5s', position: 'relative' }}>
                  <div style={{ position: 'absolute', bottom: -16, left: '50%', transform: 'translateX(-50%)', fontSize: 7, color: 'var(--text-tertiary)' }}>{['J','F','M','A','M','J','J','A','S','O','N','D'][i]}</div>
                </div>;
              })}
            </div>
          </div>

          {/* ── SERP Features ── */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', alignSelf: 'center', marginRight: 4 }}>SERP Features:</span>
            {MOCK_KEYWORD.serpFeatures.map(f => (
              <span key={f} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'color-mix(in srgb, var(--red) 8%, var(--bg-card))', color: 'var(--red)', border: '1px solid color-mix(in srgb, var(--red) 20%, var(--border))' }}>{f}</span>
            ))}
          </div>

          {/* ── Related Keywords Table ── */}
          <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Related Keywords ({MOCK_KEYWORD.related.length})</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Keyword', 'Intent', 'Volume', 'KD%', 'CPC', 'Trend'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MOCK_KEYWORD.related.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text-primary)' }}>{r.kw}</td>
                      <td style={{ padding: '10px 12px' }}><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 9, fontWeight: 700, background: `color-mix(in srgb, ${INTENT_COLORS[r.intent] || 'var(--text-tertiary)'} 12%, transparent)`, color: INTENT_COLORS[r.intent] || 'var(--text-tertiary)' }}>{r.intent}</span></td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 600 }}>{r.vol.toLocaleString()}</td>
                      <td style={{ padding: '10px 12px' }}><span style={{ color: r.kd > 60 ? 'var(--red)' : r.kd > 30 ? 'var(--yellow)' : 'var(--green)', fontWeight: 700 }}>{r.kd}</span></td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>${r.cpc.toFixed(2)}</td>
                      <td style={{ padding: '10px 12px' }}><span style={{ color: r.trend > 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{r.trend > 0 ? '↗' : '↘'} {Math.abs(r.trend)}%</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ marginTop: 8, fontSize: 9, color: 'var(--text-tertiary)', fontStyle: 'italic', textAlign: 'right' }}>📊 Preview data — connect SEMrush API for live metrics</div>
        </div>
      )}

      {/* ═══ DOMAIN ANALYTICS ═══ */}
      {activeTab === 'domain' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input value={domInput} onChange={e => setDomInput(e.target.value)} placeholder="Enter domain (e.g., zerobounce.net)"
              onKeyDown={e => e.key === 'Enter' && !loading && domInput.trim() && execute('seo/domain', { domain: domInput }).then(r => { if (r) setDomStatus(r.status || null); })}
              style={{ flex: 1, padding: '12px 16px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13 }} />
            <button onClick={() => execute('seo/domain', { domain: domInput }).then(r => { if (r) setDomStatus(r.status || null); })} disabled={loading || !domInput.trim()} style={{
              padding: '12px 20px', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, var(--purple) 0%, var(--purple) 100%)', color: 'var(--accent-contrast)', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, opacity: loading ? 0.5 : 1,
            }}>{loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Globe size={14} />} Analyze</button>
          </div>

          {domStatus === 'semrush_not_configured' && (
            <div style={{ background: 'color-mix(in srgb, var(--yellow) 8%, var(--bg-card))', borderRadius: 14, border: '1px solid color-mix(in srgb, var(--yellow) 30%, var(--border))', padding: 16, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={14} style={{ color: 'var(--yellow)', flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>SEMrush API not configured. Showing <strong>preview</strong> for <strong>{MOCK_DOMAIN.domain}</strong>.</span>
            </div>
          )}

          {/* Authority Score Gauge + Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 14, marginBottom: 16 }}>
            <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 100, height: 100, borderRadius: '50%', border: '6px solid color-mix(in srgb, var(--purple) 20%, var(--border))', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', background: `conic-gradient(var(--purple) ${MOCK_DOMAIN.authority}%, color-mix(in srgb, var(--purple) 10%, var(--bg-app)) 0)` }}>
                <div style={{ width: 76, height: 76, borderRadius: '50%', background: 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                  <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--purple)' }}>{MOCK_DOMAIN.authority}</div>
                  <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Authority</div>
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {[
                { label: 'Organic Traffic', value: (MOCK_DOMAIN.organicTraffic / 1000).toFixed(1) + 'K', color: 'var(--green)' },
                { label: 'Paid Traffic', value: (MOCK_DOMAIN.paidTraffic / 1000).toFixed(1) + 'K', color: 'var(--blue)' },
                { label: 'Organic Keywords', value: (MOCK_DOMAIN.organicKeywords / 1000).toFixed(1) + 'K', color: 'var(--red)' },
                { label: 'Backlinks', value: (MOCK_DOMAIN.backlinks / 1000).toFixed(0) + 'K', color: 'var(--yellow)' },
                { label: 'Referring Domains', value: (MOCK_DOMAIN.referringDomains / 1000).toFixed(1) + 'K', color: 'var(--purple)' },
                { label: 'Domain', value: MOCK_DOMAIN.domain, color: 'var(--text-primary)' },
              ].map((s, i) => (
                <div key={i} style={{ background: 'var(--bg-app)', borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Top Organic Keywords */}
          <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden', marginBottom: 16 }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Top Organic Keywords</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Keyword', 'Position', 'Volume', 'Est. Traffic'].map(h => (<th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>{h}</th>))}
              </tr></thead>
              <tbody>{MOCK_DOMAIN.topKeywords.map((k, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text-primary)' }}>{k.kw}</td>
                  <td style={{ padding: '10px 12px' }}><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 800, background: k.pos <= 3 ? 'color-mix(in srgb, var(--green) 12%, transparent)' : 'color-mix(in srgb, var(--yellow) 12%, transparent)', color: k.pos <= 3 ? 'var(--green)' : 'var(--yellow)' }}>#{k.pos}</span></td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{k.vol.toLocaleString()}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 600 }}>{k.traffic.toLocaleString()}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>

          {/* Competitors */}
          <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Main Organic Competitors</div>
            {MOCK_DOMAIN.competitors.map((c, i) => (
              <div key={i} style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Globe size={12} style={{ color: 'var(--purple)' }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{c.domain}</span>
                </div>
                <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--text-tertiary)' }}>
                  <span>🔑 {c.commonKw.toLocaleString()} common</span>
                  <span>📊 Authority: <strong style={{ color: 'var(--purple)' }}>{c.authority}</strong></span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8, fontSize: 9, color: 'var(--text-tertiary)', fontStyle: 'italic', textAlign: 'right' }}>📊 Preview data — connect SEMrush API for live metrics</div>
        </div>
      )}

      {/* ═══ SERP ANALYSIS ═══ */}
      {activeTab === 'ranking' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input value={rankKw} onChange={e => setRankKw(e.target.value)} placeholder="Who ranks for this keyword?"
              onKeyDown={e => e.key === 'Enter' && !loading && rankKw.trim() && execute('seo/ranking', { keyword: rankKw }).then(r => { if (r) setRankStatus(r.status || null); })}
              style={{ flex: 1, padding: '12px 16px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13 }} />
            <button onClick={() => execute('seo/ranking', { keyword: rankKw }).then(r => { if (r) setRankStatus(r.status || null); })} disabled={loading || !rankKw.trim()} style={{
              padding: '12px 20px', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, var(--blue) 0%, var(--blue) 100%)', color: 'var(--accent-contrast)', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, opacity: loading ? 0.5 : 1,
            }}>{loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <BarChart3 size={14} />} Analyze SERP</button>
          </div>

          {rankStatus === 'semrush_not_configured' && (
            <div style={{ background: 'color-mix(in srgb, var(--yellow) 8%, var(--bg-card))', borderRadius: 14, border: '1px solid color-mix(in srgb, var(--yellow) 30%, var(--border))', padding: 16, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={14} style={{ color: 'var(--yellow)', flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Showing preview for <strong>"email verification"</strong>.</span>
            </div>
          )}

          {/* SERP Results Table */}
          <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Organic Results — "email verification"</span>
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{MOCK_SERP.length} results</span>
            </div>
            {MOCK_SERP.map((r, i) => (
              <div key={i} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: r.pos <= 3 ? 'linear-gradient(135deg, var(--green) 0%, var(--green) 100%)' : r.pos <= 5 ? 'linear-gradient(135deg, var(--blue) 0%, var(--blue) 100%)' : 'var(--bg-app)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 900, color: r.pos <= 5 ? 'var(--accent-contrast)' : 'var(--text-tertiary)', flexShrink: 0 }}>#{r.pos}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</div>
                  <div style={{ fontSize: 10, color: 'var(--green)', marginTop: 2 }}>{r.domain}{r.url}</div>
                </div>
                <div style={{ display: 'flex', gap: 16, flexShrink: 0, fontSize: 10, color: 'var(--text-tertiary)' }}>
                  <div><div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>Authority</div><span style={{ fontWeight: 700, color: 'var(--purple)' }}>{r.authority}</span></div>
                  <div><div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>Traffic</div><span style={{ fontWeight: 700, color: 'var(--blue)' }}>{r.traffic.toLocaleString()}</span></div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8, fontSize: 9, color: 'var(--text-tertiary)', fontStyle: 'italic', textAlign: 'right' }}>📊 Preview data — connect SEMrush API for live metrics</div>
        </div>
      )}

      {/* ═══ CROSS-REFERENCE (WORKS NOW!) ═══ */}
      {activeTab === 'crossref' && (
        <div>
          <div style={{ background: 'color-mix(in srgb, var(--green) 6%, var(--bg-card))', borderRadius: 14, border: '1px solid color-mix(in srgb, var(--green) 20%, var(--border))', padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Database size={14} style={{ color: 'var(--green)' }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)' }}>Live — Queries ClickHouse directly</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Paste domains (one per line, comma, or semicolon separated). This checks your <code>universal_person</code> table for matching leads — lead count, verification status, companies, and job titles.
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <textarea value={crInput} onChange={e => setCrInput(e.target.value)} rows={5}
              placeholder={"zerobounce.net\nmailgun.com\nsendgrid.com\nbrevo.com\nmailchimp.com"}
              style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'monospace', lineHeight: 1.6, resize: 'vertical', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{crInput.split(/[\n,;]+/).filter(d => d.trim()).length} domains</span>
              <button onClick={runCrossRef} disabled={loading || !crInput.trim()} style={{
                padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: `linear-gradient(135deg, var(--green) 0%, var(--green) 100%)`, color: 'var(--accent-contrast)', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, opacity: loading ? 0.5 : 1,
              }}>{loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Database size={14} />} Cross-Reference</button>
            </div>
          </div>

          {/* Results */}
          {crResults && (
            <div>
              {/* Summary */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
                <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 16, textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--green)' }}>{crResults.found_in_database}</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Found in DB</div>
                </div>
                <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 16, textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--red)' }}>{crResults.not_found}</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Not Found</div>
                </div>
                <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 16, textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--accent)' }}>
                    {(crResults.matches || []).reduce((s: number, m: CrossRefResult) => s + m.lead_count, 0)}
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Total Leads</div>
                </div>
              </div>

              {/* Matched Domains */}
              {(crResults.matches || []).length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>✅ Matched Domains</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {(crResults.matches || []).map((m, i) => (
                      <div key={i} style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{m.domain}</div>
                          <div style={{ display: 'flex', gap: 8, fontSize: 10, color: 'var(--text-tertiary)', flexWrap: 'wrap' }}>
                            <span><strong>{m.lead_count}</strong> leads</span>
                            <span style={{ color: 'var(--green)' }}>✅ {m.verified_safe} safe</span>
                            {m.verified_risky > 0 && <span style={{ color: 'var(--yellow)' }}>⚠️ {m.verified_risky} risky</span>}
                            <span>🏢 {m.unique_companies} companies</span>
                          </div>
                          {m.sample_titles?.length > 0 && (
                            <div style={{ display: 'flex', gap: 3, marginTop: 6, flexWrap: 'wrap' }}>
                              {m.sample_titles.slice(0, 5).map((t, j) => (
                                <span key={j} style={{ padding: '2px 6px', borderRadius: 4, fontSize: 8, fontWeight: 600, background: 'var(--accent-muted)', color: 'var(--accent)' }}>{t}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <button onClick={() => copy(m.domain, `cr-${i}`)} style={{ padding: 6, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-app)', cursor: 'pointer', color: copied === `cr-${i}` ? 'var(--green)' : 'var(--text-tertiary)' }}>
                          {copied === `cr-${i}` ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Missing Domains */}
              {(crResults.missing_domains || []).length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>❌ Not in Database</div>
                  <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 14, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {(crResults.missing_domains || []).map((d, i) => (
                      <span key={i} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: 'color-mix(in srgb, var(--red) 8%, var(--bg-app))', color: 'var(--red)', border: '1px solid color-mix(in srgb, var(--red) 20%, var(--border))' }}>{d}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══ KEYWORD GAP ═══ */}
      {activeTab === 'competitor' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
            <input value={compDomain} onChange={e => setCompDomain(e.target.value)} placeholder="Your domain"
              style={{ padding: '12px 16px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13 }} />
            <input value={compTarget} onChange={e => setCompTarget(e.target.value)} placeholder="Competitor domain"
              style={{ padding: '12px 16px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13 }} />
          </div>
          <button onClick={() => execute('seo/competitor', { domain: compDomain, competitor_domain: compTarget }).then(r => { if (r) setCompStatus(r.status || null); })} disabled={loading || !compDomain.trim()} style={{
            padding: '12px 20px', borderRadius: 12, border: 'none', cursor: 'pointer', width: '100%',
            background: 'linear-gradient(135deg, var(--yellow) 0%, var(--yellow) 100%)', color: 'var(--accent-contrast)', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, opacity: loading ? 0.5 : 1, marginBottom: 16,
          }}>{loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <GitCompare size={14} />} Analyze Gap</button>

          {compStatus === 'semrush_not_configured' && (
            <div style={{ background: 'color-mix(in srgb, var(--yellow) 8%, var(--bg-card))', borderRadius: 14, border: '1px solid color-mix(in srgb, var(--yellow) 30%, var(--border))', padding: 16, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={14} style={{ color: 'var(--yellow)', flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Showing preview gap analysis.</span>
            </div>
          )}

          {/* Gap Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
            <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--green)' }}>{MOCK_GAP.shared}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Shared Keywords</div>
            </div>
            <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--blue)' }}>{MOCK_GAP.yourUnique}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Your Unique</div>
            </div>
            <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--red)' }}>{(MOCK_GAP.theirUnique / 1000).toFixed(1)}K</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Their Unique (Gap)</div>
            </div>
          </div>

          {/* Gap Table */}
          <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Top Keyword Gaps — Keywords they rank for that you don't</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Keyword', 'Volume', 'Their Position', 'Your Position'].map(h => (<th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>{h}</th>))}
              </tr></thead>
              <tbody>{MOCK_GAP.gaps.map((g, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text-primary)' }}>{g.kw}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{g.vol.toLocaleString()}</td>
                  <td style={{ padding: '10px 12px' }}><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 800, background: 'color-mix(in srgb, var(--green) 12%, transparent)', color: 'var(--green)' }}>#{g.theirPos}</span></td>
                  <td style={{ padding: '10px 12px' }}>{g.yourPos ? <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 800, background: 'color-mix(in srgb, var(--yellow) 12%, transparent)', color: 'var(--yellow)' }}>#{g.yourPos}</span> : <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: 'color-mix(in srgb, var(--red) 12%, transparent)', color: 'var(--red)' }}>Not ranking</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div style={{ marginTop: 8, fontSize: 9, color: 'var(--text-tertiary)', fontStyle: 'italic', textAlign: 'right' }}>📊 Preview data — connect SEMrush API for live metrics</div>
        </div>
      )}

      {toast && <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, padding: '14px 22px', borderRadius: 12, maxWidth: 420, background: toast.type === 'error' ? 'var(--red)' : toast.type === 'warning' ? 'var(--yellow)' : 'var(--accent)', color: toast.type === 'warning' ? 'var(--text-primary)' : 'var(--accent-contrast)', fontSize: 12, fontWeight: 600, boxShadow: 'var(--shadow-lg)', animation: 'slideUp 0.25s ease-out', cursor: 'pointer' }} onClick={() => setToast(null)}>{toast.type === 'error' ? '❌' : toast.type === 'warning' ? '⚠️' : 'ℹ️'} {toast.message}</div>}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes slideUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>

      {/* Oracle Agent */}
      <div style={{ marginTop: 36 }}>
        <AgentCard slug="seo_strategist" contextLabel="SEO & Audience Intelligence" />
      </div>
    </>
  );
}
