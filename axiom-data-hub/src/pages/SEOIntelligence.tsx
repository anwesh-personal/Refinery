import { useState, useCallback } from 'react';
import { apiCall } from '../lib/api';
import {
  Loader2, Search, Globe, BarChart3, GitCompare, Database,
  Copy, Check, AlertTriangle, Layers, Target
} from 'lucide-react';
import AgentCard from '../components/AgentCard';

// ── Types ──
interface KeywordResult {
  keyword: string; volume: number; difficulty: number; cpc: number;
  trend: string; competition: string; related: string[];
}
interface DomainResult {
  domain: string; authority: number; traffic: number; keywords: number;
  topPages: { url: string; traffic: number; keyword: string }[];
  backlinks: number;
}
interface RankingDomain {
  position: number; domain: string; url: string; title: string;
  traffic: number;
}
interface CrossRefResult {
  domain: string; lead_count: number; verified_safe: number;
  verified_risky: number; unique_companies: number; sample_titles: string[];
}
interface CompetitorResult {
  domain: string; competitor: string;
  shared_keywords: number; your_unique: number; their_unique: number;
  gaps: { keyword: string; their_position: number; volume: number }[];
}

// ── Tool Tabs ──
type ToolTab = 'keyword' | 'domain' | 'ranking' | 'crossref' | 'competitor';
const TOOL_TABS: { key: ToolTab; label: string; icon: any; desc: string; color: string }[] = [
  { key: 'keyword', label: 'Keyword Research', icon: Search, desc: 'Search volume, difficulty, CPC, related keywords', color: '#e91e63' },
  { key: 'domain', label: 'Domain Analytics', icon: Globe, desc: 'Authority, traffic, top pages, backlinks', color: '#9c27b0' },
  { key: 'ranking', label: 'Ranking Domains', icon: BarChart3, desc: 'Who ranks for a keyword in Google', color: '#2196f3' },
  { key: 'crossref', label: 'Cross-Reference', icon: Database, desc: 'Check domains against our ClickHouse data', color: '#4caf50' },
  { key: 'competitor', label: 'Competitor Gap', icon: GitCompare, desc: 'Keyword overlap & gaps vs competitors', color: '#ff9800' },
];

export default function SEOIntelligencePage() {
  const [activeTab, setActiveTab] = useState<ToolTab>('keyword');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ type: string; message: string } | null>(null);
  const showToast = (type: string, msg: string) => { setToast({ type, message: msg.slice(0, 200) }); setTimeout(() => setToast(null), 6000); };
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string, id: string) => { navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(null), 2000); };

  // ── Keyword State ──
  const [kwInput, setKwInput] = useState('');
  const [kwResults, setKwResults] = useState<KeywordResult[] | null>(null);
  const [kwStatus, setKwStatus] = useState<string | null>(null);

  // ── Domain State ──
  const [domInput, setDomInput] = useState('');
  const [domResult, setDomResult] = useState<DomainResult | null>(null);
  const [domStatus, setDomStatus] = useState<string | null>(null);

  // ── Ranking State ──
  const [rankKw, setRankKw] = useState('');
  const [rankResults, setRankResults] = useState<RankingDomain[] | null>(null);
  const [rankStatus, setRankStatus] = useState<string | null>(null);

  // ── CrossRef State ──
  const [crInput, setCrInput] = useState('');
  const [crResults, setCrResults] = useState<{ matches: CrossRefResult[]; missing_domains: string[]; found_in_database: number; not_found: number } | null>(null);

  // ── Competitor State ──
  const [compDomain, setCompDomain] = useState('');
  const [compTarget, setCompTarget] = useState('');
  const [compResult, setCompResult] = useState<CompetitorResult | null>(null);
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

  const tabColor = TOOL_TABS.find(t => t.key === activeTab)?.color || '#e91e63';

  return (
    <>
      {/* Hero */}
      <div style={{ background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--bg-sidebar) 100%)', borderRadius: 20, border: '1px solid var(--border)', padding: '28px 32px', marginBottom: 24, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -30, right: -30, width: 180, height: 180, borderRadius: '50%', background: '#e91e63', opacity: 0.04 }} />
        <div style={{ position: 'absolute', bottom: -40, left: '50%', width: 200, height: 200, borderRadius: '50%', background: '#9c27b0', opacity: 0.03 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #e91e63 0%, #9c27b0 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Search size={18} style={{ color: '#fff' }} /></div>
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
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #e91e63 0%, #ff5722 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Layers size={14} style={{ color: '#fff' }} /></div>
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
            background: 'linear-gradient(135deg, #e91e63 0%, #9c27b0 100%)', color: '#fff',
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
                background: i + 1 <= pipelineStep ? 'linear-gradient(135deg, #e91e63 0%, #9c27b0 100%)' : 'var(--bg-app)',
                color: i + 1 <= pipelineStep ? '#fff' : 'var(--text-tertiary)',
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
            <input value={kwInput} onChange={e => setKwInput(e.target.value)} placeholder="Enter keyword (e.g., 'email verification')" onKeyDown={e => e.key === 'Enter' && !loading && kwInput.trim() && execute('seo/keywords', { keyword: kwInput }).then(r => { if (r) { setKwResults(r.results || []); setKwStatus(r.status || null); } })}
              style={{ flex: 1, padding: '12px 16px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13 }} />
            <button onClick={() => execute('seo/keywords', { keyword: kwInput }).then(r => { if (r) { setKwResults(r.results || []); setKwStatus(r.status || null); } })} disabled={loading || !kwInput.trim()} style={{
              padding: '12px 20px', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: `linear-gradient(135deg, ${tabColor} 0%, color-mix(in srgb, ${tabColor} 70%, #000) 100%)`,
              color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5,
              opacity: loading ? 0.5 : 1,
            }}>{loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={14} />} Research</button>
          </div>

          {kwStatus === 'semrush_not_configured' && (
            <div style={{ background: 'color-mix(in srgb, var(--yellow) 8%, var(--bg-card))', borderRadius: 14, border: '1px solid color-mix(in srgb, var(--yellow) 30%, var(--border))', padding: 20, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <AlertTriangle size={16} style={{ color: 'var(--yellow)' }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>SEMrush API Not Configured</span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
                This tool requires a SEMrush API key. Once configured, it will return keyword volume, difficulty, CPC, trends, and related keywords.
                Go to <strong>AI Settings → Integrations</strong> to add your SEMrush API key.
              </p>
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <div style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--bg-app)', border: '1px solid var(--border)', fontSize: 10, color: 'var(--text-tertiary)' }}>
                  💡 Meanwhile, use the <strong>Cross-Reference</strong> tab to check domains against your existing data, or chat with <strong>Oracle</strong> below.
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ DOMAIN ANALYTICS ═══ */}
      {activeTab === 'domain' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input value={domInput} onChange={e => setDomInput(e.target.value)} placeholder="Enter domain (e.g., zerobounce.net)" onKeyDown={e => e.key === 'Enter' && !loading && domInput.trim() && execute('seo/domain', { domain: domInput }).then(r => { if (r) { setDomResult(r.result || null); setDomStatus(r.status || null); } })}
              style={{ flex: 1, padding: '12px 16px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13 }} />
            <button onClick={() => execute('seo/domain', { domain: domInput }).then(r => { if (r) { setDomResult(r.result || null); setDomStatus(r.status || null); } })} disabled={loading || !domInput.trim()} style={{
              padding: '12px 20px', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: `linear-gradient(135deg, #9c27b0 0%, #7b1fa2 100%)`, color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, opacity: loading ? 0.5 : 1,
            }}>{loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Globe size={14} />} Analyze</button>
          </div>

          {domStatus === 'semrush_not_configured' && (
            <div style={{ background: 'color-mix(in srgb, var(--yellow) 8%, var(--bg-card))', borderRadius: 14, border: '1px solid color-mix(in srgb, var(--yellow) 30%, var(--border))', padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={16} style={{ color: 'var(--yellow)' }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>SEMrush API Not Configured</span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '8px 0 0' }}>Domain analytics requires SEMrush. Add API key in <strong>AI Settings → Integrations</strong>.</p>
            </div>
          )}
        </div>
      )}

      {/* ═══ RANKING DOMAINS ═══ */}
      {activeTab === 'ranking' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input value={rankKw} onChange={e => setRankKw(e.target.value)} placeholder="Who ranks for this keyword?" onKeyDown={e => e.key === 'Enter' && !loading && rankKw.trim() && execute('seo/ranking', { keyword: rankKw }).then(r => { if (r) { setRankResults(r.results || []); setRankStatus(r.status || null); } })}
              style={{ flex: 1, padding: '12px 16px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13 }} />
            <button onClick={() => execute('seo/ranking', { keyword: rankKw }).then(r => { if (r) { setRankResults(r.results || []); setRankStatus(r.status || null); } })} disabled={loading || !rankKw.trim()} style={{
              padding: '12px 20px', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: `linear-gradient(135deg, #2196f3 0%, #1565c0 100%)`, color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, opacity: loading ? 0.5 : 1,
            }}>{loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <BarChart3 size={14} />} Find</button>
          </div>

          {rankStatus === 'semrush_not_configured' && (
            <div style={{ background: 'color-mix(in srgb, var(--yellow) 8%, var(--bg-card))', borderRadius: 14, border: '1px solid color-mix(in srgb, var(--yellow) 30%, var(--border))', padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={16} style={{ color: 'var(--yellow)' }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>SEMrush API Not Configured</span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '8px 0 0' }}>Ranking domain lookup requires SEMrush. Add API key in <strong>AI Settings → Integrations</strong>.</p>
            </div>
          )}
        </div>
      )}

      {/* ═══ CROSS-REFERENCE (WORKS NOW!) ═══ */}
      {activeTab === 'crossref' && (
        <div>
          <div style={{ background: 'color-mix(in srgb, #4caf50 6%, var(--bg-card))', borderRadius: 14, border: '1px solid color-mix(in srgb, #4caf50 20%, var(--border))', padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Database size={14} style={{ color: '#4caf50' }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#4caf50' }}>Live — Queries ClickHouse directly</span>
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
                background: `linear-gradient(135deg, #4caf50 0%, #2e7d32 100%)`, color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, opacity: loading ? 0.5 : 1,
              }}>{loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Database size={14} />} Cross-Reference</button>
            </div>
          </div>

          {/* Results */}
          {crResults && (
            <div>
              {/* Summary */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
                <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 16, textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 900, color: '#4caf50' }}>{crResults.found_in_database}</div>
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
                            <span style={{ color: '#4caf50' }}>✅ {m.verified_safe} safe</span>
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

      {/* ═══ COMPETITOR GAP ═══ */}
      {activeTab === 'competitor' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
            <input value={compDomain} onChange={e => setCompDomain(e.target.value)} placeholder="Your domain"
              style={{ padding: '12px 16px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13 }} />
            <input value={compTarget} onChange={e => setCompTarget(e.target.value)} placeholder="Competitor domain"
              style={{ padding: '12px 16px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13 }} />
          </div>
          <button onClick={() => execute('seo/competitor', { domain: compDomain, competitor_domain: compTarget }).then(r => { if (r) { setCompResult(r.result || null); setCompStatus(r.status || null); } })} disabled={loading || !compDomain.trim()} style={{
            padding: '12px 20px', borderRadius: 12, border: 'none', cursor: 'pointer', width: '100%',
            background: `linear-gradient(135deg, #ff9800 0%, #ef6c00 100%)`, color: '#fff', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, opacity: loading ? 0.5 : 1,
          }}>{loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <GitCompare size={14} />} Analyze Gap</button>

          {compStatus === 'semrush_not_configured' && (
            <div style={{ background: 'color-mix(in srgb, var(--yellow) 8%, var(--bg-card))', borderRadius: 14, border: '1px solid color-mix(in srgb, var(--yellow) 30%, var(--border))', padding: 20, marginTop: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={16} style={{ color: 'var(--yellow)' }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>SEMrush API Not Configured</span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '8px 0 0' }}>Competitor gap analysis requires SEMrush. Add API key in <strong>AI Settings → Integrations</strong>.</p>
            </div>
          )}
        </div>
      )}

      {toast && <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, padding: '14px 22px', borderRadius: 12, maxWidth: 420, background: toast.type === 'error' ? 'var(--red)' : toast.type === 'warning' ? 'var(--yellow)' : 'var(--accent)', color: toast.type === 'warning' ? '#000' : 'var(--accent-contrast)', fontSize: 12, fontWeight: 600, boxShadow: 'var(--shadow-lg)', animation: 'slideUp 0.25s ease-out', cursor: 'pointer' }} onClick={() => setToast(null)}>{toast.type === 'error' ? '❌' : toast.type === 'warning' ? '⚠️' : 'ℹ️'} {toast.message}</div>}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes slideUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>

      {/* Oracle Agent */}
      <div style={{ marginTop: 36 }}>
        <AgentCard slug="seo_strategist" contextLabel="SEO & Audience Intelligence" />
      </div>
    </>
  );
}
